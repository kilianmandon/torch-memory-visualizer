import subprocess
import os
from tempfile import TemporaryDirectory
import pickle
import shutil

import torch
import torch.distributed
from torch.utils._python_dispatch import TorchDispatchMode
from pathlib import Path
from contextlib import ExitStack


class memory_snapshot:
    def __init__(self, snapshot_name, save_path:str|Path=None, on_oom:bool=True, log_shapes:bool=False, source_root:str|Path=None, save_site_packages:bool=False, share:bool=False, share_code:str=None):
        """
        A context manager that wraps PyTorch's memory utils to record all memory events, and appends your project's 
        source code to the snapshot. With the attached source code, the snapshots can be used 
        in the Torch Memory Visualizer.

        Args:
            snapshot_name (str): Name of your snapshot. If save_path only leads to a directory, this name 
                is used to build the filename.
            save_path (str | Path, optional): Output filepath of the memory snapshot. If None, no local file will be saved. Either save_path or share=True must be provided. Defaults to None.
            on_oom (bool, optional): Whether or not to register an observer that specifically
                saves snapshots when an OOM event occured. Defaults to True.
            source_root (str | Path, optional): Root directory of your project. 
                If None, the working directory will be used. Files will be saved, if they
                - fall within source_root/**/*.py
                - occured in the snapshot
                - do not contain 'site-packages' (if save_site_packages is False)

                Defaults to None.
            log_shapes (bool, optional): If True, attaches a TorchDispatchMode that logs address, shapes, and dtype
                of all operations. Defaults to False.
            save_site_packages (bool, optional): Whether or not to include source files from the
                site-packages folder in the snapshot. Defaults to False.
            share (bool, optional): Whether or not to provide the snapshot for peer-to-peer file sharing
                with croc. This is for situations in which you want to download the snapshot from a cloud
                instance to your local machine. Defaults to False.
            share_code (str, optional): The sharing code used by croc. If None, a random code will be generated. 
                Defaults to None.

        Raises:
            ValueError: If invalid parameters are chosen, or if CUDA is not available (memory recording
                only works on CUDA devices).
        """

        if save_path is None and not share:
            raise ValueError(f"Either save_path or share=True must be set to save the generated snapshot.")

        if not torch.cuda.is_available():
            raise ValueError("CUDA is not available. Memory snapshot generation only supports CUDA.")

        if share and shutil.which('croc') is None:
            raise ValueError("""The share=True option was enabled, but croc is not available. Install croc using "curl https://getcroc.schollz.com | bash".""")

        if source_root is None:
            self.source_root = Path('.')
        elif isinstance(source_root, str):
            self.source_root = Path(source_root)
        else:
            self.source_root = source_root
        self.save_site_packages = save_site_packages

        self.snapshot_name=snapshot_name
        self.save_path = save_path
        if self.save_path is not None:
            self.save_path = Path(save_path)
            if self.save_path.is_dir():
                self.save_path = self.save_path / f'{snapshot_name}_snapshot.pkl'
        self.on_oom=on_oom
        self.share=share
        self.share_code=share_code
        self.log_shapes = log_shapes

        self._ended_with_oom = False
        self.save_current_source_code()

    def __enter__(self):
        self._stack = ExitStack()
        self.tempdir = self._stack.enter_context(TemporaryDirectory())
        if self.log_shapes:
            self.shape_logger = self._stack.enter_context(ShapeLogger())
        torch.cuda.memory._record_memory_history()

        if self.on_oom:
            self.setup_oom_observer()

        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is not None and exc_type!=torch.OutOfMemoryError:
                print("Exception observed (non-OOM), snapshot is not being saved.")
            else:
                print('Starting memory trace processing...')
                if not self._ended_with_oom:
                    data = torch.cuda.memory._snapshot() 
                else:
                    data = self._oom_snapshot

                if self.log_shapes:
                    data['shape_data'] = [self.shape_logger.logs]

                assert 'device_traces' in data, 'No device traces recorded.'
                distributed = (torch.distributed.is_available() and torch.distributed.is_initialized())
                rank = 0 if not distributed else torch.distributed.get_rank()

                if distributed:
                    try:
                        print('Gathering traces from distributed GPUs...')
                        world_size = torch.distributed.get_world_size()
                        all_data = [None for _ in range(world_size)] if rank==0 else None
                        torch.distributed.gather_object(data, all_data, dst=0)
                        print('Gathering complete.')

                        if rank==0:
                            data['device_traces'] = [all_data[i]['device_traces'][i] for i in range(world_size)]
                            if self.log_shapes:
                                data['shape_data'] = [all_data[i]['shape_data'][0] for i in range(world_size)]
                    except Exception as e:
                        if rank==0:
                            print(f'Trace gathering failed: {e}. Only data from rank 0 will be saved.')

                
                if rank==0:
                    print('Saving data...')
                    if self.save_path is not None:
                        out_path = Path(self.save_path)
                    else:
                        out_path = Path(self.tempdir + f'/{self.snapshot_name}_snapshot.pkl')

                    if self._ended_with_oom:
                        out_path = out_path.with_name(f'oom_{out_path.name}')

                    self.attach_source_code(data, out_path)

                    if self.share:
                        self.share_snapshot(out_path)
                    print('Done.')
        finally:
            self._stack.close()
            torch.cuda.memory._record_memory_history(enabled=None)

    def share_snapshot(self, snapshot_path):
        print('\nSharing snapshot through croc, download by running snapkit-receiver your_secret_code or directly using croc.')
        snapshot_path = str(snapshot_path)
        env = os.environ.copy()
        cmd = ['croc', 'send', snapshot_path]
        if self.share_code is not None:
            env["CROC_SECRET"] = self.share_code

        for i in range(5):
            result = subprocess.run(cmd, env=env)
            if result.returncode == 0:
                print("Transfer successful!")
                break
            else:
                print("Transfer failed, retrying...")
        else:
            print("Transfer failed. Memory snapshot was not shared.")



    def save_current_source_code(self):
        source_code = {}
        for path in self.source_root.glob('**/*.py'):
            filename = str(path.absolute())
            if self.save_site_packages or 'site-packages' not in filename:
                source_code[filename] = path.read_text()

        self.source_code = source_code

    def attach_source_code(self, data, out_file):
        used_source_filenames = []

        trace_entries = data['device_traces'][0]
        files_to_analyze = set()
        for entry in trace_entries:
            for frame in entry['frames']:
                files_to_analyze.add(frame['filename'])

        for filename in files_to_analyze:
            if filename in self.source_code:
                used_source_filenames.append(filename)

        source_code = {filename: self.source_code[filename] for filename in used_source_filenames}
        data['source_code'] = source_code

        with open(out_file, 'wb') as f:
            pickle.dump(data, f)


    def setup_oom_observer(self):
        def oom_observer(device, alloc, device_alloc, device_free):
            # snapshot right after an OOM happened
            print('CUDA OOM observerd, saving memory snapshot.')
            self._oom_snapshot = torch.cuda.memory._snapshot()
            self._ended_with_oom = True

        torch._C._cuda_attach_out_of_memory_observer(oom_observer)


class ShapeLogger(TorchDispatchMode):
    def __init__(self):
        self.logs = {}

    def __torch_dispatch__(self, func, types, args=(), kwargs=None):
        kwargs = kwargs or {}
        result = func(*args, **kwargs)
        if isinstance(result, torch.Tensor) and result.is_cuda:
            k = hex(result.data_ptr())
            if k not in self.logs:
                self.logs[k] = []
            self.logs[k].append([str(func), tuple(result.shape), str(result.dtype)])
        return result