# Torch Memory Visualizer: Python Lib
This is a small convenience library to that uses torch to record memory snapshots and attach the source code for files in the stack trace. These snapshots with source code included can be used by the [Torch Memory Visualizer](https://kilianmandon.github.io/torch-memory-visualizer/) to analyze memory usage.

## Example Usage
```python
import torch
from torch import nn
from torch_memviz import memory_snapshot

def main():
    model = nn.Sequential(nn.Linear(32, 10), nn.ReLU(), nn.Linear(10, 32))
    x = torch.randn((64, 32))
    y = model(x)
    y.sum().backward()
        
if __name__=='__main__':
    with memory_snapshot('test_run', save_path='.'):
        main()
```
