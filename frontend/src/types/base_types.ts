export interface Frame {
    filename: string;
    lineno: number,
    name: string,
}

export interface MemoryEvent {
    start: number,
    end: number,
    size: number,
    frames: Frame[],
    allocation_type: string,
    address: number,
    event_index: number,
}

export interface PolygonData {
    coords: number[][];
    event: MemoryEvent,
}

export interface TimelineSelection {
    selected: Set<MemoryEvent>;
}