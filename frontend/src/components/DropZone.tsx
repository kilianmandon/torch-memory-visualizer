import { useCallback, useRef, useState } from "react";
import styles from "../css/DropZone.module.css";

interface Props {
    onFile: (file: File) => void;
    children: React.ReactNode;
    showEmptyState: boolean;
}
export function DropZone({ onFile, children, showEmptyState }: Props) {
    const [dragging, setDragging] = useState(false);

    const dragDepth = useRef(0);

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
        }
    }

    const handleDragOver = (e: React.DragEvent) => e.preventDefault();

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
    }, [onFile]);


    return <div 
        className={styles.wrapper} 
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        >
        {dragging && (
            <div className={styles.overlay}>
                <span className={styles.overlayText}>Drop to load snapshot</span>
            </div>
        )}
        {showEmptyState && (
            <div className={styles.emptyState}>
                <span>Drag a memory snapshot file anywhere to load it</span>
            </div>
        )}
        {children}
        </div>;

}