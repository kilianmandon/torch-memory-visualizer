import { useEffect, useState } from 'react'
import styles from './css/App.module.css';
import { AllocationTimeline } from './components/AllocationTimeline'
import type { MemoryEvent, PolygonData } from './types/base_types'
import { DropZone } from './components/DropZone'
import { unpickleUsingJS } from './utils/pyodide'
import { buildPolygonData, calculateTotalMemoryOverTime, extractEvents, type SnapshotData } from './utils/data_extraction'
import { aggregateInfo, parseMemoryTree, pruneMemoryTreeByTime, pruneMemoryTreeToEvents, setupSourceCodeAnalysis, walkAllNodes } from './utils/memory_tree'
import { MemoryTreeView } from './components/MemoryTreeView'
import { isMethodNode, type AllocationNode, type MemoryTree, type MethodNode, type SourceCodeAnalysis, type TreeNode } from './types/memory_tree_types'
import { CodeView } from './components/CodeView'
import { Group, Panel } from 'react-resizable-panels';
import Placeholder from './components/Placeholder';
import Header from './components/Header';



export interface NodeSelection {
  selectedNodeIDs: Set<number>;
  activeSelectionID?: number;
  activeLine?: number;
  activeEvent?: MemoryEvent;
}

export interface ProcessedSnapshotData {
  events: MemoryEvent[];
  sourceCodeAnalysis?: SourceCodeAnalysis;
}



interface ButtonControlsProps {
  onPeak: () => void;
  onSelection: () => void;
  onFull: () => void;
  polygonCount: number;
  onPolygonChange: (n: number) => void;
  onPolygonChangeCommitted: (n: number) => void;
  nodeThreshold: number;
  onNodeThresholdChange: (x: number) => void;
  numMemoryEvents: number;
  selectedDevice: number;
  numDevices: number;
  onDeviceChange: (i: number)=>void;
}

export function formatBytes(v: number) {
  if (v == 0) return "0";
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GiB`
  else if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(0)} MiB`
  else if (v >= 1024) return `${(v / 1024 ** 1).toFixed(0)} KiB`
  else return `${v} bytes`
}

function ButtonControls({ onPeak, onSelection, onFull, onPolygonChange, onPolygonChangeCommitted, onNodeThresholdChange, numMemoryEvents, polygonCount, nodeThreshold, selectedDevice, numDevices, onDeviceChange }: ButtonControlsProps) {

  return (
    <div className={styles.controls}>
      <div className={styles.header}>
        <span>Controls</span>
      </div>
      <div className={styles.row}>
        <button onClick={onPeak}>Peak</button>
        <button onClick={onSelection}>Selection</button>
        <button onClick={onFull}>Full Trace</button>
      </div>
      <div className={styles.selectRow}>
        <label>Device</label>
        <select
          value={selectedDevice}
          onChange={(e) => onDeviceChange(Number(e.target.value))}
        >
          {Array.from({ length: numDevices }, (_, i) => (
            <option key={i} value={i}>
              Device {i}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.sliderRow}>
        <label>Polygons</label>
        <input
          type="range"
          min={0}
          max={numMemoryEvents}
          step={100}
          value={polygonCount}
          onChange={(e) => onPolygonChange(Number(e.target.value))}
          onMouseUp={(e) => onPolygonChangeCommitted(Number((e.target as HTMLInputElement).value))}
        />
        <span>{polygonCount}</span>
      </div>
      <div className={styles.sliderRow}>
        <label>Min Node Size</label>
        <input
          type="range"
          min={0}
          max={2000}
          step={10}
          value={nodeThreshold}
          onChange={(e) => onNodeThresholdChange(Number(e.target.value))}
        />
        <span>{formatBytes(nodeThreshold * 1024 ** 2)}</span>
      </div>
    </div>
  )
}

export function nodeByID(memoryTree: MemoryTree, id: number): TreeNode {
  for (let node of walkAllNodes(memoryTree)) {
    if (node.node_id === id) return node;
  }
  throw new Error(`Node not found in memory tree: ${id}`);
}

function App() {
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotLoadingProgress, setSnapshotLoadingProgress] = useState(0)
  const [memoryTreeBuildingProgress, setMemoryTreeBuildingProgress] = useState(0);
  const [snapshotData, setSnapshotData] = useState<SnapshotData|null>(null);
  const [selectedDevice, setSelectedDevice] = useState<number>(0);
  // Show up to 15000 polys by default
  const [polygonCount, setPolygonCount] = useState<number>(15000);
  // Show nodes with at least 1 GiB in the tree view
  const [nodeThreshold, setNodeThreshold] = useState<number>(0);

  const [polygonData, setPolygonData] = useState<PolygonData[] | null>(null);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const [ephemeralTimelineSelect, setEphemeralTimelineSelect] = useState<MemoryEvent | null>(null);
  const [nodeSelection, setNodeSelection] = useState<NodeSelection>({ selectedNodeIDs: new Set() })

  const [allMemoryEvents, setAllMemoryEvents] = useState<MemoryEvent[] | null>(null);
  const [allMemoryTree, setAllMemoryTree] = useState<MemoryTree | null>(null);
  const [totalMemoryOverTime, setTotalMemoryOverTime] = useState<number[] | null>(null);

  const [activeEvents, setActiveEvents] = useState<MemoryEvent[] | null>(null);
  const [activeMemoryTree, setActiveMemoryTree] = useState<MemoryTree | null>(null);

  const [timePrunedMemoryTree, setTimePrunedMemoryTree] = useState<MemoryTree | null>(null);
  const [nodeByMethodNameLookup, setNodeByMethodNameLookup] = useState<Map<string, Set<number>> | null>(null);


  const [sourceCodeAnalysis, setSourceCodeAnalysis] = useState<SourceCodeAnalysis | null>(null);

  useEffect(() => {
    console.log('Trying to apply new snapshot data.');
    if (!snapshotData) return;

    setAllMemoryTree(null);
    setActiveMemoryTree(null);
    setTimePrunedMemoryTree(null);
    setActiveEvents(null);
    setSourceCodeAnalysis(null);
    setLoadingSnapshot(true);

    console.log('Applying new snapshot data.');
    extractEvents(snapshotData, selectedDevice, progressCallback(setSnapshotLoadingProgress, 30, 60)).then(events => setAllMemoryEvents(events));

    if (snapshotData.source_code) {
      setupSourceCodeAnalysis(snapshotData.source_code).then(sca => setSourceCodeAnalysis(sca));
    }

  }, [snapshotData, selectedDevice])


  useEffect(() => {
    const hasData = allMemoryEvents && polygonData && totalMemoryOverTime;
    if (hasData) setLoadingSnapshot(false);
  }, [allMemoryEvents, polygonData, totalMemoryOverTime])

  useEffect(() => {
    if (!allMemoryEvents) return;
    parseMemoryTree(allMemoryEvents, sourceCodeAnalysis, progressCallback(setMemoryTreeBuildingProgress, 0, 50)).then(memTree => setAllMemoryTree(memTree));
  }, [allMemoryEvents, sourceCodeAnalysis]);

  useEffect(() => {
    setActiveEvents(allMemoryEvents);
  }, [allMemoryEvents]);


  useEffect(() => {
    if (!activeEvents) return;
    setTotalMemoryOverTime(calculateTotalMemoryOverTime(activeEvents));
    console.log(`Creating polygons from ${activeEvents.length} entries`)
    buildPolygonData(activeEvents, polygonCount, progressCallback(setSnapshotLoadingProgress, 60, 100)).then(polyData => setPolygonData(polyData));
  }, [activeEvents]);

  useEffect(() => {
    if (!activeEvents || !allMemoryTree) return;
    pruneMemoryTreeToEvents(allMemoryTree, activeEvents, progressCallback(setMemoryTreeBuildingProgress, 50, 70)).then(tree => setActiveMemoryTree(tree));
  }, [activeEvents, allMemoryTree])


  useEffect(() => {
    if (!activeMemoryTree) return;
    let toSet: MemoryTree;
    if (activeTime == null) {
      toSet = activeMemoryTree;
      const nodesByMethodName = aggregateInfo(toSet);
      setNodeByMethodNameLookup(nodesByMethodName);
      setTimePrunedMemoryTree(toSet);
    } else {
      pruneMemoryTreeByTime(activeMemoryTree, activeTime, progressCallback(setMemoryTreeBuildingProgress, 70, 100)).then( memoryTree => {
        const nodesByMethodName = aggregateInfo(memoryTree);
        setNodeByMethodNameLookup(nodesByMethodName);
        setTimePrunedMemoryTree(memoryTree);
      });
    }
  }, [activeMemoryTree, activeTime]);



  const onSelectAllocationTimeline = (events: MemoryEvent[], t: number | null) => {
    if (events.length == 0) {
      setNodeSelection({
        selectedNodeIDs: new Set(),
      });
      return;
    }
    if (events.length != 1) console.error(`Timeline selection should return one or 0 events, gave ${events}.`);

    setActiveTime(t);
    setEphemeralTimelineSelect(events[0]);
  };

  useEffect(() => {
    if (!ephemeralTimelineSelect || !timePrunedMemoryTree) {
      return;
    }

    let activeEvent: AllocationNode | null = null;
    for (let node of walkAllNodes(timePrunedMemoryTree)) {
      if (!isMethodNode(node)) {
        if ((node as AllocationNode).event.event_index == ephemeralTimelineSelect.event_index) {
          activeEvent = (node as AllocationNode);
          break;
        }
      }
    }
    if (!activeEvent) {
      console.error(`Node lookup of index ${ephemeralTimelineSelect.event_index} failed.`);
      return;
    }
    const activeSelection: MethodNode = activeEvent.parent as MethodNode;
    const selectedNodeIDs: Set<number> = new Set([activeSelection.node_id!]);
    const activeLine = activeEvent?.parent_lineno;

    setNodeSelection(_ => {
      let obj: NodeSelection = { selectedNodeIDs };
      if (activeSelection != null) obj.activeSelectionID = activeSelection.node_id!;
      if (activeLine != null) obj.activeLine = activeLine;
      if (activeEvent != null) obj.activeEvent = activeEvent.event;
      return obj
    });
    setEphemeralTimelineSelect(null);

  }, [ephemeralTimelineSelect, timePrunedMemoryTree]);

  const onClickMemoryTree = (methodNode: MethodNode, event: React.MouseEvent) => {
    if (!timePrunedMemoryTree) return;
    event.preventDefault();
    let selectedNodeIDs = new Set(nodeSelection.selectedNodeIDs);
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      selectedNodeIDs.add(methodNode.node_id!);
    } else if (event.altKey) {
      const key = `${methodNode.func_class ?? 'no_class'}.${methodNode.func_name ?? '<module>'}`;
      selectedNodeIDs = nodeByMethodNameLookup?.get(key) ?? new Set<number>([methodNode.node_id!]);
    } else {
      selectedNodeIDs = new Set([methodNode.node_id!]);
    }


    for (let node_id of [...selectedNodeIDs]) {
      let node = nodeByID(timePrunedMemoryTree, node_id);
      let parent = node.parent;
      while (parent) {
        if (selectedNodeIDs.has(parent.node_id!)) {
          selectedNodeIDs.delete(node_id);
          break;
        }
        parent = parent.parent;
      }
    };

    setNodeSelection({ selectedNodeIDs, activeSelectionID: methodNode.node_id! });
  };

  const activeTimeToPeak = () => {
    if (!totalMemoryOverTime) return;
    const goto = totalMemoryOverTime.indexOf(totalMemoryOverTime.reduce((a, b) => Math.max(a, b), -Infinity));
    setActiveTime(goto);
  }

  useEffect(() => {
    if (!totalMemoryOverTime) return;
    activeTimeToPeak();
  }, [totalMemoryOverTime]);

  const setActiveEventsToAllMemEvents = () => {
    setTimePrunedMemoryTree(null);
    setPolygonData(null);
    setLoadingSnapshot(true);
    setActiveEvents(allMemoryEvents);
  }

  const setActiveEventsToSelection = () => {
    console.log("Trying to narrow selection.");
    if (!timePrunedMemoryTree) return;
    const selMemEvents: MemoryEvent[] = [];
    for (let node_id of nodeSelection.selectedNodeIDs) {
      let methodNode = nodeByID(timePrunedMemoryTree, node_id)
      if (!methodNode.aggregationInfo) return;
      methodNode.aggregationInfo.totalEvents.forEach(e => selMemEvents.push(e));
    }
    console.log(`Narrowing selection to ${selMemEvents.length}`);
    if (selMemEvents.length > 0) {
      setTimePrunedMemoryTree(null);
      setPolygonData(null);
      setLoadingSnapshot(true);
      setActiveEvents(selMemEvents);
    }
  }

  const hasData = allMemoryEvents && polygonData && totalMemoryOverTime;
  const onPolygonNumChangeCommited = (n: number) => {
    // This callback is currently unused (not triggered correctly)
    console.log("Trying to change poly count");
    if (!activeEvents) return;
    console.log(`Restricting to ${polygonCount} polys`);
    buildPolygonData(activeEvents, n, progressCallback(setSnapshotLoadingProgress, 60, 100)).then(polyData => setPolygonData(polyData));
  }

  const progressCallback = (proggressSetter: (p: number)=>void, low=0, high=100) => {
    return (p: number) => proggressSetter(Math.floor(low + (high - low) * p / 100));
  }

  return (
    <>
      <Header githubUrl="https://github.com/kilianmandon/torch-memory-visualizer" />
      <DropZone showEmptyState={!hasData && !loadingSnapshot} onFile={f => {

        unpickleUsingJS(f, progressCallback(setSnapshotLoadingProgress, 0, 30)).then(data => setSnapshotData(data));
      }}>
        <Group className={styles.app} orientation="vertical">
          <Panel style={{ width: "100%" }} defaultSize="40vh">
            {loadingSnapshot ?
              <Placeholder
                loading
                title="Loading data..."
                progress={snapshotLoadingProgress}
              /> :
              hasData &&
              <AllocationTimeline nodeSelection={nodeSelection} polygonData={polygonData} onSelect={onSelectAllocationTimeline} totalMemoryOverTime={totalMemoryOverTime} memoryEvents={allMemoryEvents} activeTime={activeTime} memoryTree={timePrunedMemoryTree} />
            }
          </Panel>
          <Panel>
            <Group>
              <Panel defaultSize="30em">
                {hasData &&
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <ButtonControls onSelection={setActiveEventsToSelection} onFull={setActiveEventsToAllMemEvents} onPeak={activeTimeToPeak} polygonCount={polygonCount} nodeThreshold={nodeThreshold} onPolygonChange={(n) => { setPolygonCount(n); if (activeEvents) { buildPolygonData(activeEvents, n, progressCallback(setSnapshotLoadingProgress, 60, 100)).then(polyData => setPolygonData(polyData)); } }} onNodeThresholdChange={(x) => { setNodeThreshold(x) }} onPolygonChangeCommitted={onPolygonNumChangeCommited} numMemoryEvents={activeEvents?.length ?? 0} selectedDevice={selectedDevice} numDevices={snapshotData?.device_traces.length ?? 1} onDeviceChange={(i)=>setSelectedDevice(i)}/>
                    <div className={styles.controlsDivider} />
                    {!timePrunedMemoryTree ?
                      <Placeholder
                        loading
                        title="Building memory tree..."
                        subtitle="This may take a few seconds"
                        progress={memoryTreeBuildingProgress}
                      />
                      : (
                        <MemoryTreeView memoryTree={timePrunedMemoryTree} onClick={onClickMemoryTree} nodeSelection={nodeSelection} nodeThreshold={nodeThreshold} />
                      )}
                  </div>
                }
              </Panel>
              <Panel>
                {hasData &&
                  (
                    !timePrunedMemoryTree ? (
                      <Placeholder
                        loading
                        title="Building memory tree..."
                      />
                    ) : !sourceCodeAnalysis ? (
                      <Placeholder
                        title="Source information unavailable"
                        subtitle="Upload a heap snapshot containing source information to enable annotated source view."
                      />
                    ) : (nodeSelection?.activeSelectionID == null) ? (
                      <Placeholder
                        title="No allocation selected"
                        subtitle="Select an allocation in the timeline or memory tree to inspect its source"
                      />
                    ) :
                      <CodeView memoryTree={timePrunedMemoryTree} nodeSelection={nodeSelection} sourceCodeAnalysis={sourceCodeAnalysis} />
                  )
                }
              </Panel>
            </Group>
          </Panel>
        </Group>
      </DropZone>
    </>
  );
}

export default App
