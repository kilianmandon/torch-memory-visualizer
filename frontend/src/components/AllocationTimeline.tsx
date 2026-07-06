import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { PolygonData } from "../types/base_types";
import * as d3 from 'd3';
import { formatBytes, nodeByID, type MemoryEvent, type NodeSelection } from "../App";
import { calculateTotalMemoryOverTime } from "../utils/data_extraction";
import type { MemoryTree } from "../types/memory_tree_types";


interface Props {
    nodeSelection: NodeSelection;
    polygonData: PolygonData[];
    onSelect: (events: MemoryEvent[], t: number)=>void;
    totalMemoryOverTime: number[];
    memoryEvents: MemoryEvent[];
    activeTime: number|null;
    memoryTree: MemoryTree|null;
}

const darkThemePalette = [
    '#38bdf8', // Sky Blue
    '#34d399', // Emerald
    '#fbbf24', // Amber
    '#f472b6', // Pink
    '#a78bfa', // Purple
    '#fb7185', // Rose
    '#60a5fa', // Blue
    '#2dd4bf', // Teal
    '#f59e0b', // Warm Amber
    '#c084fc'  // Light Purple
];

function hashCode(num: number) {
  const numStr = num.toString();
  let hash = 0;
  for (let i = 0; i < numStr.length; i++) {
    const charCode = numStr.charCodeAt(i);
    hash = (hash << 5) - hash + charCode;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

interface PolygonCanvasProps {
    canvasDiv: HTMLDivElement;
    polygonData: PolygonData[];
    onMouseover: (event: React.MouseEvent, d: PolygonData) => void;
    onMouseleave: (event: React.MouseEvent, d: PolygonData) => void;
    onMouseclick: (coords: number[], d: PolygonData) => void;
    onMouseclickClear: (coords: number[]) => void;
    totalMemoryOverTime: number[];
    activeTime: number|null;
}

interface CanvasData {
    xMax: number;
    yMax: number;
    plotWidth: number;
    plotHeight: number;
    polygonRefs: object[];
    zoomGroup: object;
}

function createPolygonCanvas({canvasDiv, polygonData, onMouseover, onMouseleave, onMouseclick, onMouseclickClear, totalMemoryOverTime, activeTime}: PolygonCanvasProps) {
    const displayedMemoryOverTime = calculateTotalMemoryOverTime(polygonData.map(e=>e.event));
    const container = d3.select(canvasDiv);
    container.selectAll('*').remove();

    const rect = canvasDiv.getBoundingClientRect();
    const width = rect.width || 1024;
    const height = rect.height || 576;
    const leftPad = 75;
    const bottomPad = 0;
    const plotWidth = width - leftPad;
    const plotHeight = height - bottomPad;

    const xmax = d3.max(polygonData, d => d3.max(d.coords.map(p => p[0])));
    const ymax = totalMemoryOverTime.reduce((a,b)=>Math.max(a, b), -Infinity) * 1.3;

    const xScale = d3.scaleLinear().domain([0, xmax]).range([0, plotWidth]);
    const yScale = d3.scaleLinear().domain([0, ymax]).range([plotHeight, 0]);

    const svg = container
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('overflow', 'visible')

    const plotCoordinateSpace = svg.append('g').attr('transform', `translate(${leftPad}, ${0})`)

    const cp = svg.append('clipPath').attr('id', 'clip');
    cp.append('rect').attr('width', plotWidth).attr('height', plotHeight);

    const plotOuter = plotCoordinateSpace.append('g').attr('clip-path', 'url(#clip)')
    plotOuter.append('rect')
        .attr('width', plotWidth)
        .attr('height', plotHeight)
        .attr('fill', 'var(--bg-elevated)');

    const zoomGroup = plotOuter.append('g');
    const scrubGroup = zoomGroup.append('g');

    const gapAreaGenerator = d3.area<number>()
        .x((_, i) => xScale(i))
        .y0((_, i) => yScale(displayedMemoryOverTime[i]))
        .y1((_, i) => yScale(totalMemoryOverTime[i]));

    zoomGroup.append('path')
        .datum(totalMemoryOverTime)
        .attr('d', gapAreaGenerator)
        .attr('fill', 'gray')
        .attr('opacity', 1.0)
        .style('pointer-events', 'none')


    function coordFormat(coords: number[][]) {
        return coords.map(p => `${xScale(p[0])},${yScale(p[1])}`).join(' ');
    }

    const coloredPolys = polygonData.map((d) => ({ ...d, color: darkThemePalette[Math.abs(hashCode(d.event.address)) % darkThemePalette.length] }));
    const polygons = scrubGroup
        .selectAll('polygon')
        .data(coloredPolys)
        .enter()
        .append('polygon')
        .attr('points', d => coordFormat(d.coords))
        .attr('fill', d => d.color)
        .attr('opacity', d => 1)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

    polygons.on('mouseover', onMouseover);
    polygons.on('mouseleave', onMouseleave);
    polygons.on('click', (event, d) => {
        event.preventDefault();
        const [x, y] = d3.pointer(event, zoomGroup.node());
        onMouseclick([x, y], d);
    });
    plotOuter.on('click', (event) => {
        if (event.defaultPrevented) {
            return;
        }
        const [x, y] = d3.pointer(event, zoomGroup.node());
        onMouseclickClear([x, y]);
    });

    plotOuter.on('wheel', (event) => {
        event.preventDefault();
    }, {passive: false});

    const yAxis = d3.axisLeft(yScale).tickFormat(d => `${(d/1024**3).toFixed(1)} GiB`);
    const axisG = plotCoordinateSpace.append('g').call(yAxis);

    const handleZoom = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const transform = event.transform;
        axisG.call(yAxis.scale(transform.rescaleY(yScale)));
        zoomGroup.attr('transform', transform);
    }

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 100])
        .on('zoom', handleZoom);

    plotCoordinateSpace.call(zoomBehavior)

    return { polygonRefs: polygons, xMax: xmax, yMax: ymax, plotWidth, plotHeight, zoomGroup };
}

function HoveredInfo({hovered, nodeSelection, totalMemoryOverTime}: {hovered: MemoryEvent|null, nodeSelection: NodeSelection, totalMemoryOverTime: number[] }) {
    const selectedEvent = nodeSelection?.activeEvent || hovered;
    let fullString;
    if (!selectedEvent) fullString = "";
    else {
        const size = selectedEvent.size;
        const addr = selectedEvent.address;
        const totalAfter = totalMemoryOverTime[selectedEvent.start];
        const userFrameBlacklist = ['site-packages', '/tmp', '/usr/lib', '??', '<frozen runpy>', '.cpp']
        const userFrames = selectedEvent.frames?.filter(frame => !userFrameBlacklist.some(x => frame.filename.includes(x)) && frame.filename.length>0);
        const stacktraceSummary = (userFrames && userFrames.length > 0) ? ` | ${userFrames.at(-1)?.filename}:${userFrames.at(0)?.lineno}` : "";
        fullString = `Address ${addr} | Size ${formatBytes(size)} | Total size after ${formatBytes(totalAfter)}${stacktraceSummary}`;
    }
    
    return <p style={{ margin: 0, height: '20px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-dim)' }}>{fullString}</p>
}


export function AllocationTimeline(
    { nodeSelection, polygonData, onSelect, totalMemoryOverTime, memoryEvents, activeTime, memoryTree }: Props
) {
    const [hovered, setHovered] = useState<MemoryEvent | null>(null);
    const [canvasData, setCanvasData] = useState<CanvasData|null>(null);
    const [activeLine, setActiveLine] = useState<object|null>(null);
    const [selected, setSelected] = useState(new Set<number>());

    const canvasRef = useRef<HTMLDivElement>(null);
    const onMouseover = useEffectEvent((event, d) => {
        setHovered(memoryEvents[d.event.event_index]);
    });
    const onMouseleave = useEffectEvent((event, d) => {
        setHovered(null);
    });
    const onMouseclick = useEffectEvent(([x, y]: number[], d) => {
        if (!canvasData) return;
        let t = Math.round(x / canvasData.plotWidth * canvasData.xMax);
        
        onSelect([memoryEvents[d.event.event_index]], t);
    });
    const onMouseclickClear = useEffectEvent(([x, y]: number[]) => {
        if (!canvasData) {
            console.warn("Canvas not fully loaded at event time.");
            return;
        }
        let t = Math.round(x / canvasData.plotWidth * canvasData.xMax);
        onSelect([], t);
    });

    useEffect(() => {
        if (!canvasData) return;
        if (activeTime != null) {
            const xScale = d3.scaleLinear().domain([0, canvasData.xMax]).range([0, canvasData.plotWidth]);
            let x = xScale(activeTime);
            if (activeLine == null) {
                let newActiveLine = canvasData.zoomGroup.append('line')
                    .attr('x1', x)
                    .attr('y1', 0)
                    .attr('x2', x)
                    .attr('y2', canvasData.plotHeight)
                    .attr('stroke', 'white')
                    .attr('stroke-dasharray', '6 4')
                    .attr('stroke-width', 1)
                    .style('pointer-events', 'none');
                console.log('Adding new line.');
                setActiveLine(newActiveLine);
            } else {
                console.log('Moving line.');
                activeLine.attr('x1', x).attr('x2', x);
            }
        } else {
            if (activeLine) {
                console.log('Deleting line.');
                activeLine.remove();
                setActiveLine(null);
            }
        }

        return () => {
            activeLine?.remove();
            setActiveLine(null);
        }
    }, [activeTime, canvasData]);


    useEffect(() => {
        if (!canvasRef.current) return;
        
        let canvasData = createPolygonCanvas({canvasDiv: canvasRef.current, polygonData, onMouseover, onMouseleave, onMouseclick, onMouseclickClear, totalMemoryOverTime, activeTime});
        setCanvasData(canvasData);
        
    }, [polygonData]);

    useEffect(() => {
        if (!nodeSelection || !memoryTree) return;
        if (nodeSelection.activeEvent) {
            setSelected(new Set([nodeSelection.activeEvent.event_index]));
            return;
        }
        let selectedNodes = [...nodeSelection.selectedNodeIDs].map(i=>nodeByID(memoryTree, i))

        const totalSelection = new Set<number>();
        for (let methodNode of selectedNodes) {
            if (!methodNode.aggregationInfo) continue;
            for (let event of methodNode.aggregationInfo.totalEvents) {
                totalSelection.add(event.event_index);
            }
        }
        setSelected(totalSelection);

    }, [nodeSelection])
    useEffect(() => {
        if (!canvasData || !canvasData.polygonRefs) return; 

        canvasData.polygonRefs.each(function(d, i) {
            const isSelected = selected.has(d.event.event_index);
            const highlight = isSelected|| d.event.event_index === hovered?.event_index;
            const selectedOpacity = 1.0;
            const unselectedOpacity = (selected.size>0) ? 0.7 : 1.0;
            d3.select(this)
                .attr('stroke', _ => highlight ? (isSelected? 'var(--accent)' : 'var(--text)' ): null)
                .attr('fill', () => isSelected ? 'var(--accent)' : darkThemePalette[Math.abs(hashCode(d.event.address))%darkThemePalette.length])
                .attr('stroke-width', _ => highlight ? '1.5px' : null)
                .attr('opacity', () => isSelected? selectedOpacity: unselectedOpacity);
                // .attr('vector-effect', _ => highlight ? 'non-scaling-stroke' : null);
        })
    }, [selected, hovered, canvasData])


    return (
        <div style={{ display: 'flex', width: '100%', flexDirection: 'column', padding: '12px', paddingBottom: '0px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', marginBottom: 'var(--space-3)', height: '100%'}}>
            <div ref={canvasRef} style={{ width: '100%', height: '100%', marginBottom: 0 }}>
            </div>
            <hr style={{ border: '0', borderTop: '1px solid var(--border)', width: '100%' }}/>
            <HoveredInfo hovered={hovered} nodeSelection={nodeSelection} totalMemoryOverTime={totalMemoryOverTime}/>
        </div>
    );
}