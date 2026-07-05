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