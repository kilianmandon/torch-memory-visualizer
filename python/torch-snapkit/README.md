# Torch Snapkit
This is a light-weight wrapper around PyTorch's memory recording utils, that additionally attaches the source code of your files for later analysis. The snapshots are designed to be visualized with [Torch Memory Visualizer](https://kilianmandon.github.io/torch-memory-visualizer/), which helps tracking memory usage back to individual lines and shows you how much memory which of your modules used.

## Example Usage
```python
import torch
from torch import nn
from torch_snapkit import memory_snapshot

def main():
    model = nn.Sequential(nn.Linear(32, 10), nn.ReLU(), nn.Linear(10, 32))
    model.to(device='cuda')
    x = torch.randn((64, 32)).to(device='cuda')
    y = model(x)
    y.sum().backward()
 

if __name__=='__main__':
    with memory_snapshot('test_run', save_path='.'):
        main()
```

In addition, the `memory_snapshot` manager provides some convenient options:
- `on_oom`: Configures PyTorch to save memory snapshots after OOM occured.
- `share`: Enables you to quickly download the generated snapshots by using `croc`, a peer-to-peer filesharing tool. This flag is for situations where you generate your snapshots on a cloud instance, but want to inspect the stacktraces on your local machine.

Here is an example usage of the snapshot utility with `share=True`:
```python
import torch
from torch import nn
from torch_snapkit import memory_snapshot

def main():
    model = nn.Sequential(nn.Linear(32, 10), nn.ReLU(), nn.Linear(10, 32))
    model.to(device='cuda')
    x = torch.randn((64, 32)).to(device='cuda')
    y = model(x)
    y.sum().backward()
 

if __name__=='__main__':
    with memory_snapshot('test_run_shared', share=True, share_code='your_secret_code'):
        main()
```

Then, on your local machine, you can either run 
```bash
CROC_SECRET="your_secret_code" croc
```
after the remote run completed, or you can run
```bash
snapkit-receive your_secret_code
```
which just calls `croc` in a loop and downloads all files that are being send under that code.