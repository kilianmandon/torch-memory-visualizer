import { useEffect, useState } from "react";
import { isMethodNode, type MemoryTree, type MethodNode } from "../types/memory_tree_types";
import { nodeByID, type NodeSelection } from "../App";
import styles from "../css/MemoryTreeView.module.css";
import { walkAllNodes } from "../utils/memory_tree";

function isLarge(node: MethodNode, threshold: number) {
    return (node.aggregationInfo?.totalSize ?? 0) > threshold * 1024**2;
}
function getNodeChildren(node: MethodNode, nodeThreshold: number) {
    const allChilds = [];
    for (let i = 0; i < node.lines.length; i++) {
        const childs = node.lines[i];
        for (const child of childs) {
            if (isMethodNode(child) && isLarge(child, nodeThreshold)) allChilds.push(child);
        }
    }
    return allChilds;
}

interface NodeComponentProps {
    methodNode: MethodNode,
    children: MethodNode[];
    name: string;
    totalSize: number;
    nodeID: number;
    depth: number;
    expandedNodes: Record<number, boolean>;
    onClick: (methodNode: MethodNode, event: React.MouseEvent) => void;
    onExpandClicked: (nodeID: number, event: React.MouseEvent) => void;
    nodeSelection: NodeSelection;
    nodeThreshold: number;
}

interface RenderNodeProps {
    methodNode: MethodNode;
    depth: number;
    expandedNodes: Record<number, boolean>;
    onClick: (methodNode: MethodNode, event: React.MouseEvent) => void;
    onExpandClicked: (node: number, event: React.MouseEvent) => void;
    nodeSelection: NodeSelection;
    nodeThreshold: number;
}

function RenderNode({ methodNode, depth, expandedNodes, onClick, onExpandClicked, nodeSelection, nodeThreshold }: RenderNodeProps) {
    let totalSize = methodNode.aggregationInfo!.totalSize;
    if (!isLarge(methodNode, nodeThreshold)) {
        return <></>;
    }

    let name = methodNode.func_class ? `${methodNode.func_class}.${methodNode.func_name}` : methodNode.func_name;
    let finalFileName = methodNode.filename.split('/').at(-1);
    let nameWithFile = finalFileName ? `${finalFileName}:${name}` : name;

    let props = {
        children: getNodeChildren(methodNode, nodeThreshold),
        name: nameWithFile,
        nodeID: methodNode.node_id!,
        totalSize: totalSize,
        depth,
        expandedNodes,
        onClick,
        onExpandClicked,
        methodNode,
        nodeSelection,
        nodeThreshold
    }
    return <NodeComponent {...props} />
}

function NodeComponent({ children, name, totalSize, nodeID, depth, expandedNodes, onClick, onExpandClicked, methodNode, nodeSelection, nodeThreshold }: NodeComponentProps) {
    const hasChildren = children.length > 0;
    const isExpanded = expandedNodes[nodeID];
    // const isActiveSelected = nodeSelection.activeSelection?.node_id == nodeID;
    const isSelected = nodeSelection.selectedNodeIDs.has(nodeID);

    return (
        <div key={nodeID} >
            <div className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`} style={{ paddingLeft: `${depth * 14 + 8}px` }} onClick={(e) => onClick(methodNode, e)}>
                <div className={styles.rowLabel}>
                    <span onClick={(e) => { e.stopPropagation(); onExpandClicked(nodeID, e) }} className={styles.expandToggle}>
                        {hasChildren ? (isExpanded ? '▼' : '▶') : ""}
                    </span>
                    <span className={styles.name}>{name}</span>
                </div>
                <span className={styles.size}>{(totalSize / 1024 ** 3).toFixed(1)} GiB</span>
            </div>
            {hasChildren && isExpanded && (
                <div>
                    {children.map(child => 
                    <RenderNode 
                        key={child.node_id}
                        methodNode={child} 
                        depth={depth + 1} 
                        expandedNodes={expandedNodes} 
                        onClick={onClick} 
                        onExpandClicked={onExpandClicked} 
                        nodeSelection={nodeSelection}
                        nodeThreshold={nodeThreshold} 
                        />
                    )}
                </div>
            )}
        </div>
    );

}

interface Props {
    memoryTree: MemoryTree;
    onClick: (methodNode: MethodNode, e: React.MouseEvent) => void;
    nodeSelection: NodeSelection;
    nodeThreshold: number;
}

export function MemoryTreeView({ memoryTree, onClick, nodeSelection, nodeThreshold }: Props) {
    const [expandedNodes, setExpandedNodes] = useState<Record<number, boolean>>({});
    const selectedNodes = [...nodeSelection.selectedNodeIDs].map(i => nodeByID(memoryTree, i));
    const totalSelectedMemory = selectedNodes.map(m => m.aggregationInfo?.totalSize ?? 0).reduce((a, b)=>a+b, 0);

    useEffect(() => {
        setExpandedNodes(prev => {
            const next = {...prev};
            selectedNodes.forEach(v => {
                let currentNode = v.parent;
                while (currentNode != null) {
                    next[currentNode.node_id!] = true;
                    currentNode = currentNode.parent;
                }
            });
            return next;
        });
    }, [nodeSelection]);

    const toggleExpand = (nodeId: number) => {
        setExpandedNodes(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
    }

    const onExpandClicked = (nodeID: number, e: React.MouseEvent) => {
        e.stopPropagation();
        toggleExpand(nodeID);
    }

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <span>Memory tree</span>
                {totalSelectedMemory !== undefined && (
                    <span className={styles.headerTotal}>{(totalSelectedMemory/1024**3).toFixed(1)} GiB selected</span>
                )}
            </div>
            <div className={styles.tree}>
                {memoryTree.roots.filter(isMethodNode).map((n, i) => (
                    <RenderNode
                        key={i}
                        methodNode={n}
                        depth={0}
                        expandedNodes={expandedNodes}
                        onExpandClicked={onExpandClicked}
                        onClick={onClick}
                        nodeSelection={nodeSelection}
                        nodeThreshold={nodeThreshold}
                    />
                ))}
            </div>
        </div>
    );

}