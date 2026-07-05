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