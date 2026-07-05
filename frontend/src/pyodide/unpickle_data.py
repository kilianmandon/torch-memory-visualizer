import pickle
import json

with open('upload.pkl', 'rb') as f:
    data = pickle.load(f)

data_json = json.dumps(data)


