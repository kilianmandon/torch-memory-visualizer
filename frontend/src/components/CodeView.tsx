import { formatBytes, nodeByID, type NodeSelection } from "../App";
import type { MemoryTree, MethodNode, SourceCodeAnalysis } from "../types/memory_tree_types";
import SyntaxHighlighter from "react-syntax-highlighter";
import { a11yDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "../css/CodeView.module.css";

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

    useLayoutEffect(() => {
        // requestAnimationFrame(() => {
        if (!preRef.current) return;
        const codeLines = preRef.current.querySelector("code")?.children;
        const funcLineStart = activeNode?.lineno_start;
        if (!funcLineStart) return;
        const selectedLine = nodeSelection.activeLine ? nodeSelection.activeLine + funcLineStart : null;


        let goTo = (selectedLine && funcLineStart && selectedLine > funcLineStart + 4) ? selectedLine - 4 : funcLineStart - 2
        if (!codeLines) return;
        goTo = Math.max(0, Math.min(goTo, codeLines.length - 1));
        if (codeLines && goTo) {
            const offset = codeLines[goTo].offsetTop - preRef.current.getBoundingClientRect().top;
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
        if (!activeNode || !nodeSelection.activeLine) return { style };
        const activeLine = nodeSelection.activeLine + activeNode.lineno_start;
        if (nodeSelection.activeLine != null && lineNumber - 1 == activeLine) {
            style.backgroundColor = 'var(--line-highlight)';
        }
        return { style };
    }


    return <article className={styles.panel}>
        {sourcecodeLines &&
            <>
                <div className={styles.filename}>{filename}</div>
                <SyntaxHighlighter
                    PreTag={(props) => <pre className={styles.codewrapper} ref={preRef} {...props}></pre>}
                    language="python"
                    style={a11yDark}
                    wrapLines
                    lineProps={lineProps}
                    wrapLongLines
                    showLineNumbers
                >
                    {sourcecodeLines.join("\n")}
                </SyntaxHighlighter>
            </>
        }
    </article>;

}