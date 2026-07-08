import { formatBytes, nodeByID, type NodeSelection } from "../App";
import type { MemoryTree, MethodNode, SourceCodeAnalysis } from "../types/memory_tree_types";
import SyntaxHighlighter from "react-syntax-highlighter";
import { a11yDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "../css/CodeView.module.css";
import ShapeDisplay from "./ShapeDisplay";

interface Props {
    nodeSelection: NodeSelection;
    sourceCodeAnalysis: SourceCodeAnalysis;
    memoryTree: MemoryTree;
}
export function CodeView({ nodeSelection, sourceCodeAnalysis, memoryTree }: Props) {
    const activeNode: MethodNode|null = nodeSelection.activeSelectionID ? (nodeByID(memoryTree, nodeSelection.activeSelectionID) as MethodNode) : null;
    const filename = activeNode?.filename;
    const preRef = useRef<HTMLElement>(null);
    const [sourcecodeLines, setSourcecodeLines] = useState<string[] | null>(null);
    const [hovered, setHovered] = useState<number|null>(null);

    useLayoutEffect(() => {
        // requestAnimationFrame(() => {
        if (!preRef.current) return;
        const codeLines = preRef.current.querySelector("code")?.children;
        const funcLineStart = activeNode?.lineno_start;
        if (!funcLineStart) return;
        const selectedLine = nodeSelection.activeLine ? nodeSelection.activeLine + funcLineStart : null;


        let goTo = (selectedLine && funcLineStart && selectedLine > funcLineStart + 6) ? selectedLine - 8 : funcLineStart - 8
        if (!codeLines) return;
        goTo = Math.max(0, Math.min(goTo, codeLines.length - 1));
        if (codeLines && goTo) {
            const offset = codeLines[goTo].offsetTop; // - preRef.current.getBoundingClientRect().top;
            preRef.current.scrollTo({ top: offset });
            // codeLines[goTo].scrollIntoView({behavior: "smooth"})
        }
        // });
    }, [nodeSelection, preRef, sourcecodeLines]);


    useEffect(() => {
        if (!activeNode || !activeNode.aggregationInfo || !activeNode.filename) return
        const sourcecodeFile = sourceCodeAnalysis.fileAnalysis.get(activeNode.filename)?.file.slice();
        if (!sourcecodeFile) return;
        const lineMaxLength = sourcecodeFile.slice(activeNode.lineno_start, activeNode.lineno_end).reduce((a, b) => Math.max(a, b.length), 0)
        const methodLineAdditions = activeNode.lines.map((childs, i) => {
            const lineTotalSize = childs.map(n => n.aggregationInfo!.totalSize).reduce((a, b) => a + b, 0);
            const lineTotalNum = childs.map(n => n.aggregationInfo!.totalCount).reduce((a, b) => a + b, 0);
            const prefix = " ".repeat(lineMaxLength - sourcecodeFile[i + activeNode.lineno_start].length)
            const comment = lineTotalNum > 0 ? `${prefix} # ${formatBytes(lineTotalSize)} | ${lineTotalNum} events` : "";
            return comment;
        });
        for (let [i, annotation] of methodLineAdditions.entries()) {
            sourcecodeFile[i + activeNode.lineno_start] += annotation;
        }
        setSourcecodeLines(sourcecodeFile);
    }, [nodeSelection, sourceCodeAnalysis])

    const lineProps = (lineNumber: number) => {
        let style = { display: 'block' };
        if (!activeNode) return {style};
        const currentLine = lineNumber - 1 - activeNode.lineno_start;
        const out = { style, onMouseEnter: ()=>setHovered(currentLine), onMouseLeave: ()=>setHovered(null) };
        if (nodeSelection.activeLine && nodeSelection.activeLine != null && currentLine == nodeSelection.activeLine) {
            out.style.backgroundColor = 'var(--line-highlight)';
        }
        return out
    }

    if (hovered) {
        console.log(`Hovered ${hovered}`);
    }
    console.log("Rerendering.") 

    const PreTag = useCallback(
        (props) => <pre className={styles.codewrapper} ref={preRef} {...props} />,
        [] 
    );


    return <article className={styles.panel}>
        {sourcecodeLines &&
            <>
                <div className={styles.filename}>{filename}</div>
                <SyntaxHighlighter
                    PreTag={PreTag}
                    language="python"
                    style={a11yDark}
                    wrapLines
                    lineProps={lineProps}
                    wrapLongLines
                    showLineNumbers
                >
                    {sourcecodeLines.join("\n")}
                </SyntaxHighlighter>
                {hovered && 
                <ShapeDisplay nodes={activeNode?.lines[hovered] ?? []}/>}
            </>
        }
    </article>;

}