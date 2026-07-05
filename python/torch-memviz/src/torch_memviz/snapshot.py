import subprocess
from tempfile import TemporaryDirectory
import pickle

import torch
from pathlib import Path
from contextlib import ExitStack


class memory_snapshot:
    def __init__(self, snapshot_name, save_path:str|Path=None, on_oom:bool=True, source_root:str|Path=None, share:bool=False, share_code:str=None):
        if save_path is None and not share:
            raise ValueError(f"Either save_path or share=True must be set to save the generated snapshot.")

        if not torch.cuda.is_available():
            raise ValueError("CUDA is not available. Memory snapshot generation only supports CUDA.")

        if source_root is None:
            self.source_root = Path('.')
        elif isinstance(source_root, str):
            self.source_root = Path(source_root)
        else:
            self.source_root = source_root

        self.snapshot_name=snapshot_name
        self.save_path = save_path
        if self.save_path is not None:
            self.save_path = Path(save_path)
            if self.save_path.is_dir():
                self.save_path = f'{snapshot_name}_snapshot.pkl'
        self.on_oom=on_oom
        self.share=share
        self.share_code=share_code

        self._ended_with_oom = False

    def __enter__(self):
        self._stack = ExitStack()
        self.tempdir = self._stack.enter_context(TemporaryDirectory())
        torch.cuda.memory._record_memory_history()

        if self.on_oom:
            self.setup_oom_observer()

        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            torch.cuda.memory._record_memory_history(enabled=None)
            tmp_file = self.tempdir + "/memory_snapshot.pkl"
            if not self._ended_with_oom:
                torch.cuda.memory._dump_snapshot(tmp_file) 

            if self.save_path is not None:
                out_path = self.save_path
            else:
                out_path = self.tempdir + "/memory_snapshot_code_attached.pkl"

            self.attach_source_code(tmp_file, out_path)

            if self.share:
                self.share_snapshot(out_path)
        finally:
            self._stack.close()

    def share_snapshot(self, snapshot_path):
        snapshot_path = str(snapshot_path)
        cmd = ['wormhole', 'send', snapshot_path]
        if self.share_code is not None:
            cmd.extend(['--code', self.share_code])

        subprocess.run(cmd)



    def attach_source_code(self, in_file, out_file):
        with open(in_file, 'rb') as f:
            data = pickle.load(f)

        available_source_filenames = []
        for path in self.source_root.glob('**/*.py'):
            filename = str(path.absolute())
            if not 'site-packages' in filename:
                available_source_filenames.append(filename)

        used_source_filenames = []

        trace_entries = data['device_traces'][0]
        files_to_analyze = set()
        for entry in trace_entries:
            for frame in entry['frames']:
                files_to_analyze.add(frame['filename'])

        for filename in files_to_analyze:
            if filename and Path(filename).exists():
                if filename in available_source_filenames:
                    used_source_filenames.append(filename)
                else:
                    print(f"Skipping path {filename}")

        source_code = {filename: Path(filename).read_text() for filename in used_source_filenames}
        data['source_code'] = source_code

        with open(out_file, 'wb') as f:
            pickle.dump(data, f)


    def setup_oom_observer(self):
        def oom_observer(device, alloc, device_alloc, device_free):
            # snapshot right after an OOM happened
            print('Saving memory snapshot after OOM.')
            torch.cuda.memory._dump_snapshot(self.tempdir + "/memory_snapshot.pkl")
            self._ended_with_oom = True

        torch._C._cuda_attach_out_of_memory_observer(oom_observer)