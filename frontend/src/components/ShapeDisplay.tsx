import type { MemoryEvent } from "../types/base_types";
import styles from "../css//ShapeDisplay.module.css";
import { isMethodNode, type AllocationNode, type TreeNode } from "../types/memory_tree_types";
import { formatBytes } from "../App";

interface Props {
    nodes: TreeNode[];
}

interface AllocationGroup {
    dtype: string;
    shape: string;
    count: number;
    size: number;
}

function GroupDisplay({ events }: { events: Set<MemoryEvent> }) {
    const typedEvents = [...events];

    if (typedEvents.length === 0) {
        console.log(`No typed events`);
        return null;
    }


    const groups = new Map<string, AllocationGroup>();

    for (const event of typedEvents) {
        const dtype = event.dtype ?? "unknown dtype";
        const shape = event.shape ? `(${event.shape!.join(", ")})` : "unknown shape";
        const size = event.size;
        const key = `${dtype}|${shape}|${size}`;
        const previous = groups.get(key);
        if (previous) {
            previous.count += 1;
            previous.size += event.size;
        } else {
            groups.set(key, {
                dtype, shape, count: 1, size: event.size
            });
        }
    }

    const sortedGroups = [...groups.values()].sort(
        (a, b) => b.size - a.size
    );

    const visibleGroups = sortedGroups.slice(0, 2);
    const remainderGroups = sortedGroups.slice(2);
    if (remainderGroups.length > 0) {
        visibleGroups.push({
            dtype: "remainder",
            shape: `${remainderGroups.length} groups`,
            count: remainderGroups.reduce((sum, g) => sum + g.count, 0),
            size: remainderGroups.reduce((sum, g) => sum + g.size, 0),
        })
    }

    return (
        <div className={styles.groups}>
            {visibleGroups.map(group => (
                <div key={`${group.dtype}-${group.shape}`} className={styles.row}>
                    <div className={styles.main}>
                        <span className={styles.dtype}>
                            {group.dtype}
                        </span>
                        <span className={styles.shape}>
                            {group.shape}
                        </span>
                    </div>
                    <div className={styles.stats}>
                        <span>
                            {group.dtype !== "remainder" ? (
                                <>{group.count}x {formatBytes(group.size / group.count)}</>
                            ) : (
                                <>-</>
                            )
                            }
                        </span>
                        <span>
                            = {formatBytes(group.size)}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );

}

export default function ShapeDisplay({ nodes }: Props) {
    const leafEvents = new Set<MemoryEvent>();
    const directChildEvents = new Set<MemoryEvent>();
    for (const node of nodes) {
        if (isMethodNode(node)) {
            for (const event of node.aggregationInfo?.totalEvents ?? []) {
                leafEvents.add(event);
            }
        } else {
            directChildEvents.add((node as AllocationNode).event);
        }
    }

    const totalSize = [...leafEvents].reduce((a, b) => a + b.size, 0) + [...directChildEvents].reduce((a, b) => a + b.size, 0);
    if (directChildEvents.size == 0 && leafEvents.size == 0) return null;

    console.log(directChildEvents);


    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                Memory allocations
            </div>
            <div className={styles.summary}>
                {leafEvents.size + directChildEvents.size} allocations · {formatBytes(totalSize)}
            </div>
            {directChildEvents.size > 0 && (
                <>
                    <span>Direct Allocations</span>
                    <GroupDisplay events={directChildEvents} />
                </>
            )}
            {leafEvents.size > 0 && (
                <>
                    <span>from Submethods</span>
                    <GroupDisplay events={leafEvents} />
                </>
            )
            }

        </div>
    );
}