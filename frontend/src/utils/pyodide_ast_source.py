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