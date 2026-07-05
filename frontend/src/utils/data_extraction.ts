import type { Frame, MemoryEvent, PolygonData } from "../types/base_types";

type TraceEvent = {
    forward_frames?: string[];
    frames: {
        filename: string;
        line: number;
        name: string;
    }[];
    size: number;
    addr: number;
    action: string;
}

export type SnapshotData = {
    device_traces: TraceEvent[][];
    source_code? : Map<string, string[]>;
}



function extractEvent(trace_event: TraceEvent, start: number, end: number, event_index: number): MemoryEvent {
    let frames: Frame[] = [];
    let forwardFrames: Frame[] = [];

    if (trace_event.forward_frames) {
        const regex = /\s*File "(.*?)", line (\d+)/;
        for (const forwardFrame of trace_event.forward_frames) {
            const match = regex.exec(forwardFrame);
            if (!match) continue;

            const filename = match[1];
            const lineno = Number(match[2])-1;
            forwardFrames.push({
                filename: filename,
                lineno,
                name: "TODO: Parse Names",
        })
        }
    }

    for (const frame of trace_event.frames) {
        frames.push({filename: frame.filename, lineno: frame.line-1, name: frame.name})
    }

    frames = [...forwardFrames, ...frames]
        
    return {
        start, end,
        size: trace_event.size,
        address: trace_event.addr,
        allocation_type: "unknown",
        frames,
        event_index,
    }
}

export function extractEvents(snapshotData: SnapshotData) : MemoryEvent[] {
    const traceEvents = snapshotData.device_traces[0];
    const maxIndex = traceEvents.length;
    const memoryAddrToIndexMap = new Map<number, number>();
    const events: MemoryEvent[] = [];
    let currentCounter = 0;


    for (const [index, traceEvent] of traceEvents.entries()) {
        if (traceEvent.action === "alloc") {
            const lastIndex = memoryAddrToIndexMap.get(traceEvent.addr);
            if (lastIndex !== undefined) {
                console.assert(events[lastIndex].end<maxIndex, "Address reused before it was freed.");
            }
            memoryAddrToIndexMap.set(traceEvent.addr, currentCounter);
            events.push(extractEvent(traceEvent, index, maxIndex, currentCounter));
            currentCounter += 1;
        } else if (traceEvent.action === "free_completed") {
            const lastIndex = memoryAddrToIndexMap.get(traceEvent.addr);
            console.assert(lastIndex!==undefined, "Memory freed before it was allocated.");
            if (lastIndex !== undefined) {
                events[lastIndex].end = index;
            }
        }
    }

    return events;
}

export function calculateTotalMemoryOverTime(events: MemoryEvent[]) {
    const maxIndex = events.map(x=>x.end).reduce((a,b)=>Math.max(a, b), -Infinity);
    console.log(`Desired array length ${maxIndex}`);
    const memoryChanges = new Array(maxIndex).fill(0);
    for (let event of events) {
        memoryChanges[event.start] = event.size;
        memoryChanges[event.end] = -event.size;
    }
    const cumulativeMemory = new Array(maxIndex).fill(0);
    for (let i=1;i<maxIndex;i++) cumulativeMemory[i] = cumulativeMemory[i-1] + memoryChanges[i];
    return cumulativeMemory;
}

function lowerBound<T>(arr: T[], target: number, key: (x:T)=>number) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (key(arr[mid]) < target) lo = mid + 1;
        else hi=mid;
    }
    return lo;
}

export function buildPolygonData(events: MemoryEvent[], maxEntries=20_000): PolygonData[] {
    const indsToKeep = events
        .map((e, i) => ({i, size: e.size}))
        .sort((a, b) => a.size-b.size)
        .slice(-maxEntries)
        .map(x => x.i)
        .sort((a, b) => a-b)

    events = indsToKeep.map(i => events[i]);

    const timeline = [];
    for (const e of events) {
        timeline.push({event: e, t: e.start, type: 1});
        timeline.push({event: e, t: e.end, type: -1});
    }
    // Note: Second criterium is generally not required, but helps with allocations
    // that were not freed: In this case, a.t=b.t=max_entry, but the "later" event gets sorted earlier
    
    timeline.sort((a, b) => a.t - b.t || b.event.event_index - a.event.event_index);

    const polygonCoords = [];
    const activeEvents = [];
    let currentBaseline = 0;

    for (const timeline_entry of timeline) {
        if (timeline_entry.type === -1) {
            let removedIdx = lowerBound(activeEvents, timeline_entry.event.event_index, x => x.i);
            let removedPoly = activeEvents[removedIdx].polygon;
            activeEvents.splice(removedIdx, 1);

            removedPoly.yCoords.push(removedPoly.yCoords[removedPoly.yCoords.length-1]);
            removedPoly.times.push(timeline_entry.t);

            let removedSize = timeline_entry.event.size;

            for (let i=removedIdx; i<activeEvents.length;i++) {
                let pol = activeEvents[i].polygon;
                let lastY: number = pol.yCoords.at(-1)!;
                pol.yCoords.push(lastY, lastY-removedSize);
                pol.times.push(timeline_entry.t, timeline_entry.t+3);
            }

            currentBaseline -= removedSize;

        } else if (timeline_entry.type === 1) {
            let polygon = {
                event: timeline_entry.event,
                times: [timeline_entry.t],
                yCoords: [currentBaseline],
            };
            currentBaseline += timeline_entry.event.size;
            polygonCoords.push(polygon);
            activeEvents.push({polygon, i: timeline_entry.event.event_index});
        }
    }

    function formatPolygonPoints(polyData): PolygonData {
        const p0: number[][] = [];
        const p1: number[][] = [];

        for (let i=0;i<polyData.times.length; i++) {
            const x = polyData.times[i];
            const y_low = polyData.yCoords[i];
            const y_high = polyData.yCoords[i] + polyData.event.size;
            p0.push([x, y_low]);
            p1.push([x, y_high]);
        }

        const coords = p0.concat(p1.reverse());

        return {
            event: polyData.event,
            coords: coords,
        }
    }

    return polygonCoords.map(formatPolygonPoints)

}