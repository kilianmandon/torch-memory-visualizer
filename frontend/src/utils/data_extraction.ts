import type { Frame, MemoryEvent, PolygonData } from "../types/base_types";

export type TraceEvent = {
    forward_frames?: string[];
    frames: {
        filename: string;
        line: number;
        name: string;
    }[];
    size: number;
    addr: BigInt;
    action: string;
}

export type ShapeEntry = {
    func: string;
    shape: number[];
    dtype: string;
}

export type ShapeData = Map<string, ShapeEntry[]>;

export type SnapshotData = {
    device_traces: TraceEvent[][];
    source_code?: Map<string, string[]>;
    shape_data?: ShapeData[];
}

function dtypeSizeLookup(dtype: string): number {
    switch (dtype) {
        case 'torch.float64':
        case 'torch.double':
            return 8;
        case 'torch.float32':
        case 'torch.float':
            return 4;
        case 'torch.float16':
        case 'torch.half':
            return 2;
        case 'torch.bfloat16':
            return 2;

        case 'torch.complex128':
            return 16;
        case 'torch.complex64':
            return 8;

        case 'torch.int64':
        case 'torch.long':
            return 8;
        case 'torch.int32':
        case 'torch.int':
            return 4;
        case 'torch.int16':
        case 'torch.short':
            return 2;
        case 'torch.int8':
        case 'torch.char':
            return 1;

        case 'torch.uint8':
        case 'torch.byte':
            return 1;
        case 'torch.uint16':
            return 2;
        case 'torch.uint32':
            return 4;
        case 'torch.uint64':
            return 8;

        case 'torch.bool':
            return 1;

        default:
            throw new Error(`Unknown dtype: ${dtype}`);
    }
}

function checkConsistency(traceEvent: TraceEvent, shapeEntry: ShapeEntry) {
    return traceEvent.size == dtypeSizeLookup(shapeEntry.dtype) * shapeEntry.shape.reduce((a, b) => a * b, 1);
}

function extractEvent(trace_event: TraceEvent, start: number, end: number, event_index: number, shapeData: ShapeData | null): MemoryEvent {
    let frames: Frame[] = [];
    let forwardFrames: Frame[] = [];

    if (trace_event.forward_frames) {
        const regex = /\s*File "(.*?)", line (\d+)/;
        for (const forwardFrame of trace_event.forward_frames) {
            const match = regex.exec(forwardFrame);
            if (!match) continue;

            const filename = match[1];
            const lineno = Number(match[2]) - 1;
            forwardFrames.push({
                filename: filename,
                lineno,
                name: "TODO: Parse Names",
            })
        }
    }

    for (const frame of trace_event.frames) {
        frames.push({ filename: frame.filename, lineno: frame.line - 1, name: frame.name })
    }

    if (forwardFrames && forwardFrames.length > 0) {
        forwardFrames.reverse();
        frames = [...frames, ...forwardFrames];
        frames.push({
            filename: "backward_frame",
            lineno: 0,
            name: "unknown"
        });
        console.warn("inserting backward_frame");
    }

    let out: MemoryEvent = {
        start, end,
        size: trace_event.size,
        address: trace_event.addr,
        allocation_type: "unknown",
        frames,
        event_index,
    }

    if (shapeData) {
        const key = `0x${trace_event.addr.toString(16)}`;
        const data = shapeData.get(key) ?? [];
        if (data.length > 0) {
            let entry = data[0];
            if (checkConsistency(trace_event, entry)) {
                out.dtype = entry.dtype;
                out.func = entry.func;
                out.shape = entry.shape;
            }
        }
    }

    return out;
}

export async function extractEvents(snapshotData: SnapshotData, deviceIndex: number, progressCallback: (p: number) => void): Promise<MemoryEvent[]> {
    console.log(`Extrecting device ${deviceIndex} / ${snapshotData.device_traces.length}`);
    const traceEvents = snapshotData.device_traces[deviceIndex];
    const maxIndex = traceEvents.length;
    const memoryAddrToIndexMap = new Map<number, number>();
    const events: MemoryEvent[] = [];
    let currentCounter = 0;
    let shapeData = snapshotData.shape_data ? structuredClone(snapshotData.shape_data[deviceIndex]) : null;
    console.log(shapeData);

    let progress = 0;

    for (const [index, traceEvent] of traceEvents.entries()) {
        if ((index + 1) % 5000 == 0) {
            await new Promise(resolve => setTimeout(resolve, 0))
            let newProgress = Math.floor(index / traceEvents.length * 100);
            if (newProgress > progress) {
                progress = newProgress;
                progressCallback(progress);
            }
        }
        if (traceEvent.action === "alloc") {
            const lastIndex = memoryAddrToIndexMap.get(traceEvent.addr);
            if (lastIndex !== undefined) {
                console.assert(events[lastIndex].end < maxIndex, "Address reused before it was freed.");
            }
            memoryAddrToIndexMap.set(traceEvent.addr, currentCounter);
            events.push(extractEvent(traceEvent, index, maxIndex, currentCounter, shapeData));
            currentCounter += 1;
        } else if (traceEvent.action === "free_completed") {
            const lastIndex = memoryAddrToIndexMap.get(traceEvent.addr);
            console.assert(lastIndex !== undefined, "Memory freed before it was allocated.");
            if (lastIndex !== undefined) {
                events[lastIndex].end = index;
            }
        }
    }

    if (shapeData) {
        let leftoverCount = 0;
        for (let [, v] of Object.entries(shapeData)) {
            if (v.length > 0) {
                leftoverCount += v.length;
            }
        }
        console.log(`Number of logged shapes that were assigned to no memory event: ${leftoverCount}`);
        let tracedShapesCount = events.map(x => x.dtype ? 1 : 0).reduce((a: number, b: number) => a + b, 0);
        console.log(`Events with assigned shape: ${tracedShapesCount} out of ${events.length}`);
    }

    console.log(`Total event count: ${events.length}`);

    return events;
}

export function calculateTotalMemoryOverTime(events: MemoryEvent[]) {
    const maxIndex = events.map(x => x.end).reduce((a, b) => Math.max(a, b), -Infinity);
    console.log(`Desired array length ${maxIndex}`);
    const memoryChanges = new Array(maxIndex).fill(0);
    for (let event of events) {
        memoryChanges[event.start] = event.size;
        memoryChanges[event.end] = -event.size;
    }
    const cumulativeMemory = new Array(maxIndex).fill(0);
    for (let i = 1; i < maxIndex; i++) cumulativeMemory[i] = cumulativeMemory[i - 1] + memoryChanges[i];
    return cumulativeMemory;
}

function lowerBound<T>(arr: T[], target: number, key: (x: T) => number) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (key(arr[mid]) < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

export async function buildPolygonData(events: MemoryEvent[], maxEntries = 20_000, progressCallback: (p: number) => void): Promise<PolygonData[]> {
    const indsToKeep = events
        .map((e, i) => ({ i, size: e.size }))
        .sort((a, b) => a.size - b.size)
        .slice(-maxEntries)
        .map(x => x.i)
        .sort((a, b) => a - b)

    events = indsToKeep.map(i => events[i]);

    const timeline = [];
    for (const e of events) {
        timeline.push({ event: e, t: e.start, type: 1 });
        timeline.push({ event: e, t: e.end, type: -1 });
    }
    // Note: Second criterium is generally not required, but helps with allocations
    // that were not freed: In this case, a.t=b.t=max_entry, but the "later" event gets sorted earlier

    timeline.sort((a, b) => a.t - b.t || b.event.event_index - a.event.event_index);

    const polygonCoords = [];
    const activeEvents = [];
    let currentBaseline = 0;
    let progress = 0;

    for (const [k, timeline_entry] of timeline.entries()) {
        if ((k + 1) % 200 == 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            let newProgress = Math.floor(k / timeline.length * 100);
            if (newProgress > progress) {
                progress = newProgress;
                progressCallback(progress)
            }
        }

        if (timeline_entry.type === -1) {
            let removedIdx = lowerBound(activeEvents, timeline_entry.event.event_index, x => x.i);
            let removedPoly = activeEvents[removedIdx].polygon;
            activeEvents.splice(removedIdx, 1);

            removedPoly.yCoords.push(removedPoly.yCoords[removedPoly.yCoords.length - 1]);
            removedPoly.times.push(timeline_entry.t);

            let removedSize = timeline_entry.event.size;

            for (let i = removedIdx; i < activeEvents.length; i++) {
                let pol = activeEvents[i].polygon;
                let lastY: number = pol.yCoords.at(-1)!;
                pol.yCoords.push(lastY, lastY - removedSize);
                pol.times.push(timeline_entry.t, timeline_entry.t + 3);
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
            activeEvents.push({ polygon, i: timeline_entry.event.event_index });
        }
    }

    function formatPolygonPoints(polyData): PolygonData {
        const p0: number[][] = [];
        const p1: number[][] = [];

        for (let i = 0; i < polyData.times.length; i++) {
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