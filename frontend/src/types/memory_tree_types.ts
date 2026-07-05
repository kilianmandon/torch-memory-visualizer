import type { MemoryEvent } from "./base_types";

export interface AggregationInfo {
    totalSize: number;
    totalCount: number;
    totalEvents: Set<MemoryEvent>;
}

export interface TreeNode {
    parent?: TreeNode;
    parent_lineno?: number;
    node_id?: number;
    aggregationInfo?: AggregationInfo;
}
export interface MethodNode extends TreeNode {
    filename: string;
    lines: TreeNode[][];
    lineno_start: number;
    lineno_end: number;
    func_name: string;
    func_class?: string;
}

export function isMethodNode(a: TreeNode): a is MethodNode{
    return 'lines' in a;
}

export interface AllocationNode extends TreeNode {
    event: MemoryEvent;
}

export interface MemoryTree {
    roots: TreeNode[]
}

export interface Context {
    filename: string;
    funcContext: string;
    classContext?: string;
    lineno: number;
    linenoStart: number;
    linenoEnd: number;
}

export interface FileCodeAnalysis {
    contextByLine: Context[];
    filename: string;
    file: string[];
}

export interface SourceCodeAnalysis {
    fileAnalysis: Map<string, FileCodeAnalysis>;
}