import type { MemoryEvent } from "../App";
import { type MemoryTree, type SourceCodeAnalysis, type MethodNode, isMethodNode, type TreeNode, type AllocationNode, type Context, type FileCodeAnalysis, type AggregationInfo } from "../types/memory_tree_types";
import { pythonSourceCodeAnalysis } from "./pyodide";



function insertIntoTree(memoryTree: MemoryTree, event: MemoryEvent, contextStack: Context[], nodeIDCounter: number) {
    let currentNodes = memoryTree.roots;
    let currentParent: TreeNode | null = null;
    let currentParentLineno: number | null = null;

    for (const context of contextStack) {
        if (!context) console.error("Broken context", contextStack);
        const filename = context.filename;
        const funcName = context.funcContext;
        const className = context.classContext;
        const lineno = context.lineno;
        let foundNode = false;
        for (const node of currentNodes) {
            if (isMethodNode(node) && node.filename === context.filename && node.func_name === funcName && node.func_class == className) {
                currentNodes = node.lines[lineno - node.lineno_start];
                currentParent = node;
                foundNode = true;
                currentParentLineno = lineno - node.lineno_start;
                break
            }
        }

        if (!foundNode) {
            const n_lines = context.linenoEnd - context.linenoStart;
            let newNode: MethodNode = {
                filename,
                lines: [...Array(n_lines).keys()].map(_ => []),
                lineno_start: context.linenoStart,
                lineno_end: context.linenoEnd,
                func_name: context.funcContext,
                func_class: context.classContext,
                node_id: nodeIDCounter,
            }
            nodeIDCounter += 1;
            if (currentParent != null) newNode.parent = currentParent;
            if (currentParentLineno != null) newNode.parent_lineno = currentParentLineno;
            currentNodes.push(newNode);
            currentNodes = newNode.lines[lineno - newNode.lineno_start];
            currentParent = newNode;
        }
    }

    const newLeaf: AllocationNode = { event, node_id: nodeIDCounter };
    nodeIDCounter += 1;
    if (currentParent != null) newLeaf.parent = currentParent;
    if (currentParentLineno != null) newLeaf.parent_lineno = currentParentLineno;

    currentNodes.push(newLeaf);
    return nodeIDCounter;

}

export async function setupSourceCodeAnalysis(sourceFiles: Map<string, string[]>): Promise<SourceCodeAnalysis> {
    const fileAnalysis = new Map<string, FileCodeAnalysis>();
    const filename_part_blacklist = ['site-packages', '/tmp', '/usr/lib', '??'];
    for (const [filename, file] of sourceFiles.entries()) {
        if (filename_part_blacklist.map(a => filename.includes(a)).some(x => x)) continue;
        const contextByLine: Context[] = await pythonSourceCodeAnalysis(filename, file);
        const singleFileAnalysis: FileCodeAnalysis = {
            contextByLine,
            filename,
            file,
        }
        fileAnalysis.set(filename, singleFileAnalysis);
    }

    return {
        fileAnalysis
    }
}

export async function parseMemoryTree(events: MemoryEvent[], sca: SourceCodeAnalysis | null, progressCallback: (p:number)=>void): Promise<MemoryTree> {
    const memoryTree: MemoryTree = { roots: [] };
    let nodeIDCounter = 0;
    let progress = 0;

    for (let i = 0; i < events.length; i++) {
        let newProgress = Math.floor(i/events.length*100);
        if (newProgress > progress) {
            progress = newProgress;
            progressCallback(progress);
        }
        if ((i+1) % 500 == 0) await new Promise(resolve => setTimeout(resolve, 0));
        const event = events[i];
        const contextStack: Context[] = [];
        for (const frame of event.frames) {
            if (sca) {
                if (sca.fileAnalysis.has(frame.filename)) {
                    const context = sca.fileAnalysis.get(frame.filename)!.contextByLine[frame.lineno];
                    if (!context) console.warn(`Missing context in ${frame.filename}:${frame.lineno}`, sca.fileAnalysis.get(frame.filename)!.file[frame.lineno]);
                    contextStack.push(context);
                } else if (frame.filename == "backward_frame") {
                    contextStack.push({
                        filename: '',
                        funcContext: '<backward>',
                        lineno: 0,
                        linenoStart: 0,
                        linenoEnd: 1,
                    });
                }
            }
            else {
                const userFrameBlacklist = ['site-packages', '/tmp', '/usr/lib', '??', '<frozen runpy>', '.cpp']
                if (frame.filename.length > 0 && !userFrameBlacklist.some(b => frame.filename.includes(b))) {
                    const context = {
                        filename: frame.filename,
                        funcContext: '<unknown>',
                        lineno: frame.lineno,
                        linenoStart: 0,
                        linenoEnd: 1000,
                    };
                    contextStack.push(context);
                }
            }
        }
        
        contextStack.reverse();
        if (contextStack.length == 0) {
            contextStack.push({
                filename: '',
                funcContext: '<unattributed>',
                lineno: 0,
                linenoStart: 0,
                linenoEnd: 1,
            });
        }
        nodeIDCounter = insertIntoTree(memoryTree, event, contextStack, nodeIDCounter);
    }

    return memoryTree;
}

function aggregateInfoNode(node: TreeNode): AggregationInfo {
    let newAggInfo;
    if (isMethodNode(node)) {
        let totalSize = 0;
        let totalCount = 0;
        let totalEvents = new Set<MemoryEvent>();
        for (const childs of node.lines) {
            for (const child of childs) {
                const aggInfo = aggregateInfoNode(child);
                totalSize += aggInfo.totalSize;
                totalCount += aggInfo.totalCount;
                aggInfo.totalEvents.forEach(v => totalEvents.add(v));
            }
        }
        newAggInfo = { totalSize, totalCount, totalEvents }
    } else {
        newAggInfo = { totalSize: (node as AllocationNode).event.size, totalCount: 1, totalEvents: new Set([(node as AllocationNode).event]) }
    }

    node.aggregationInfo = newAggInfo;
    return newAggInfo;
}

function* walkMethodNode(methodNode: MethodNode): Generator<TreeNode> {
    for (const children of methodNode.lines) {
        for (const child of children) {
            yield child;
            if (isMethodNode(child)) {
                yield* walkMethodNode(child);
            }
        }
    }
}

export function* walkAllNodes(memoryTree: MemoryTree) {
    for (const node of memoryTree.roots) {
        yield node;
        if (isMethodNode(node)) {
            yield* walkMethodNode(node);
        }
    }
}

export function* walkAllNodesBreadthFirst(memoryTree: MemoryTree) {
    const queue: TreeNode[] = [...memoryTree.roots];
    while (queue.length > 0) {
        const node = queue.shift()!;
        yield node;
        if (isMethodNode(node)) {
            for (let line of node.lines) {
                for (let child of line) {
                    queue.push(child);
                }
            }
        }
    }
}

export function aggregateInfo(memoryTree: MemoryTree): Map<string, Set<number>> {
    // Reset old aggregation info
    for (const node of walkAllNodes(memoryTree)) {
        node.aggregationInfo = undefined;
    }

    // Compute new one
    for (const root of memoryTree.roots) {
        aggregateInfoNode(root);
    }

    const nodesByMethodName = new Map<string, Set<number>>();
    for (const node of walkAllNodes(memoryTree)) {
        if (isMethodNode(node)) {
            const key = `${node.func_class ?? 'no_class'}.${node.func_name ?? '<module>'}`;
            if (!nodesByMethodName.has(key)) nodesByMethodName.set(key, new Set());
            nodesByMethodName.get(key)?.add(node.node_id!);
        }
    }

    return nodesByMethodName;
}

export async function pruneMemoryTreeByTime(memoryTree: MemoryTree, t: number, progressCallback: (p: number)=>void) {
    const predicate = (allocationNode: AllocationNode) => allocationNode.event.start <= t && t < allocationNode.event.end;
    return await pruneMemoryTree(memoryTree, predicate, progressCallback)
}

export async function pruneMemoryTreeToEvents(memoryTree: MemoryTree, events: MemoryEvent[], progressCallback: (p: number)=>void) {
    const eventIDs = events.map(e => e.event_index);
    const predicate = (allocNode: AllocationNode) => eventIDs.includes(allocNode.event.event_index);
    return await pruneMemoryTree(memoryTree, predicate, progressCallback);
}

export async function pruneMemoryTree(memoryTree: MemoryTree, predicate: (node: AllocationNode) => boolean, progressCallback: (p: number)=>void): Promise<MemoryTree> {
    const nodesOnProgress = [];
    for (const node of walkAllNodesBreadthFirst(memoryTree)) {
        nodesOnProgress.push(node);
        if (nodesOnProgress.length > 100) break;
    }
    const progressContext: ProgressContext = {
        nodesOnProgress: nodesOnProgress.filter(a => isMethodNode(a)).map(a => a.node_id!),
        nodesFound: 0,
        iterationCounter: 0,
    }

    const innerProgressCallback = () => {
        progressContext.nodesFound++
        progressCallback(Math.floor(progressContext.nodesFound / progressContext.nodesOnProgress.length * 100))
    }
    
    progressContext.progressCallback = innerProgressCallback


    const newRoots = [];
    for (const root of memoryTree.roots) {
        if (isMethodNode(root)) {
            const newRoot = await pruneMethodNode(root, predicate, progressContext);
            if (newRoot) newRoots.push(newRoot);
        } else {
            const allocNode = (root as AllocationNode);
            if (predicate(allocNode)) newRoots.push(root);
        }
    }

    return { roots: newRoots }
}

type ProgressContext = {
    nodesOnProgress: number[],
    nodesFound: number,
    iterationCounter: number,
    progressCallback?: ()=>void
}

async function pruneMethodNode(methodNode: MethodNode, predicate: (allocNode: AllocationNode) => boolean, progressContext: ProgressContext): Promise<MethodNode | null> {
    const newLines = [];
    let anyChildren = false;
    if (progressContext.nodesOnProgress.includes(methodNode.node_id ?? -1)) {
        progressContext.progressCallback?.();
    }
    for (const oldChildren of methodNode.lines) {
        const newChildren = [];
        for (const oldChild of oldChildren) {
            if (isMethodNode(oldChild)) {
                const newChild = await pruneMethodNode(oldChild, predicate, progressContext);
                if (newChild) {
                    newChildren.push(newChild);
                    newChild.parent = methodNode;
                }
            } else {
                const allocNode = (oldChild as AllocationNode);
                if (predicate(allocNode)) {
                    oldChild.parent = methodNode;
                    newChildren.push(oldChild);
                }
            }
            progressContext.iterationCounter++;
            if (progressContext.iterationCounter % 10_000 == 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        newLines.push(newChildren);
        anyChildren = anyChildren || newChildren.length > 0;
    }

    return { ...methodNode, lines: newLines };
}