import torch
from torch import nn
from torch_snapkit import memory_snapshot

def main():
    model = nn.Sequential(nn.Linear(32, 10), nn.ReLU(), nn.Linear(10, 32))
    x = torch.randn((64, 32))
    model.to(device='cuda')
    x = x.to(device='cuda')
    y = model(x)
    y.sum().backward()
    for _ in range(1_000_000):
        x = torch.randn((1000,), device='cuda')
        
if __name__=='__main__':
    with memory_snapshot('test_run_local', save_path='.'):
        main()