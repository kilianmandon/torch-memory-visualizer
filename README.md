# Torch Memory Visualizer

This project provides a static website ([try it!](https://kilianmandon.github.io/torch-memory-visualizer/)) to inspect and debug CUDA Memory snapshots from PyTorch, similar to [this](https://docs.pytorch.org/memory_viz) tool from PyTorch. Compared to the tool by PyTorch, this one uses your source code to give info on which parts of your code make up how much memory.

## Usage
### Generate a Snapshot
Create a PyTorch snapshot as usual, and then add a `source_code` attribute to the pickle dump, e.g.
```python
import pickle
from pathlib import Path

torch.cuda.memory._record_memory_history(max_entries=100_000)
# Execute your PyTorch code here
# ...

# Save snapshot
snapshot_filename = 'snapshot_name.pkl'
torch.cuda.memory._dump_snapshot(snapshot_filename)

# Add your source code
source_filenames = list(Path('your_src_root').glob('**/*.py'))
source_code = {str(p): p.read_text() for p in source_filenames}

with open(snapshot_filename, 'rb') as f:
    snapshot_data = pickle.load(f)
snapshot_data['source_code'] = source_code
with open(snapshot_filename, 'wb') as f:
    pickle.dump(snapshot_data, f)
```

### Analyze the Snapshot
Simply drag-and-drop the pickle file into the website. The file is not uploaded to a remote server. You can select individual allocations in the timeline view, or all allocations that were from a specific call in a stacktrace (e.g. main(line 78) -> training(line 120) -> Transformer.forward(line 42) -> LayerNorm.forward(line 16)). The viewer also shows the source code of the selected method, with annotations on which lines used the memory.

The control buttons Peak, Selection, and Full Trace have the functions of setting the active time to the time of peak memory usage, narrowing the shown allocations to the current selection, or resetting it to all allocations in the file, respectively.

## Showcase Image
![alt text](https://github.com/kilianmandon/torch-memory-visualizer/blob/main/images/torch_memory_visualizer_example.png?raw=true)

## Similar Projects
PyTorch's own Memory Visualizer is open source and can be found [here](https://github.com/pytorch/pytorch/tree/main/torch/utils/viz). It is available as a Website [here](https://docs.pytorch.org/memory_viz). This project used the JavaScript python-unpickler from PyTorch's implementation.