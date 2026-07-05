import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.mjs";
import type { PyodideInterface } from "pyodide";
import type { SnapshotData } from "./data_extraction";
import { unpickleData } from "./unpickle.js";

let pyodide: PyodideInterface = null;

export async function getPyodide() {
    if (pyodide) return pyodide;
    // pyodide = await loadPyodide();
    pyodide = await loadPyodide({

            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"

        });
    await pyodide.loadPackage("orjson");
    return pyodide;
}

export async function unpickleUsingJS(file: File): Promise<SnapshotData> {
    const buffer = await file.arrayBuffer();
    const obj = unpickleData(buffer);
    if (obj.source_code) {
        const codeMap = new Map<string, string[]>();
        for (const [filename, sourcecode] of Object.entries(obj.source_code)) {
            codeMap.set(filename, sourcecode.split('\n'));
        }
        obj.source_code = codeMap;
    }
    return obj as SnapshotData;
}

export async function unpickle(file: File): Promise<SnapshotData> {
    const py = await getPyodide();
    const buffer = await file.arrayBuffer();

    py.FS.writeFile("upload.pkl", new Uint8Array(buffer));
    const result = await py.runPythonAsync(`
import pickle
import orjson
import json

with open("upload.pkl", "rb") as f:
    data = pickle.load(f)

data_subset = {
  'device_traces': [data['device_traces'][0][:10_000]]
}

if 'source_code' in data:
    source_map = { k: v.split('\\n') for k,v in data['source_code'].items() }
    data_subset['source_code'] = source_map

res = orjson.dumps(data_subset).decode('utf-8')
# res = json.dumps(data_subset)
res
`)
    // console.log(`Py result: ${result}`);
    const obj = JSON.parse(result as string);
    const snapshotData = {
        ...obj,
        source_code: obj.source_code ? new Map(Object.entries(obj.source_code)) : undefined
    };
    return snapshotData;
}

export async function pythonSourceCodeAnalysis(filename: string, sourceCode: string[]) {
    const data = JSON.stringify({filename, sourceCode});
    const py = await getPyodide();
    py.globals.set('data_str', data);
    const result = await py.runPythonAsync(
`
import ast
import json
import orjson

data = json.loads(data_str)
source_code = data['sourceCode']
filename = data['filename']

context_class_lookup = [(None, None)] * len(source_code)
context_func_lookup = [(None, None)] * len(source_code)

src_tree = ast.parse('\\n'.join(source_code), filename)
for node in ast.walk(src_tree):
    to_modify = None
    if isinstance(node, ast.ClassDef):
        to_modify = context_class_lookup
    elif isinstance(node, ast.FunctionDef):
        to_modify = context_func_lookup

    if to_modify is not None:
        for i in range(node.lineno - 1, node.end_lineno):
            if to_modify[i][1] is None or to_modify[i][1] > node.end_lineno:
                to_modify[i] = (node, node.end_lineno)

context_class_lookup = [a for a, _ in context_class_lookup]
context_func_lookup = [a for a, _ in context_func_lookup]

context_list = []

for i in range(len(source_code)):
    if not context_func_lookup[i]:
        context = {
            'filename': filename,
            'funcContext': 'global',
            'lineno': i,
            'linenoStart': 0,
            'linenoEnd': len(source_code)
        }
    else:
        func_context = context_func_lookup[i]
        context = {
            'filename': filename,
            'funcContext': func_context.name,
            'lineno': i,
            'linenoStart': func_context.lineno - 1,
            'linenoEnd': func_context.end_lineno,
        }
        if context_class_lookup[i]:
            context['classContext'] = context_class_lookup[i].name
    context_list.append(context)

orjson.dumps(context_list).decode('utf-8')
`
)
    return JSON.parse(result as string);

}