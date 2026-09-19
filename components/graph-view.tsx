"use client";
import * as React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Connection,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon, typeIconName } from "@/components/icons";
import { useApp } from "@/components/app-context";
import { useAddDep } from "@/hooks/use-beads";
import { catColor, typeColor } from "@/lib/beads-view";
import { containerLayout } from "@/lib/graph-containers";
import { graphScope, graphEdges } from "@/lib/graph-model";
import { ResponsiveControls } from "@/components/responsive-controls";
import { useGraphPrefs } from "@/hooks/use-graph-prefs";
import { graphNeighborhood } from "@/lib/graph-neighborhood";
import type { Bead } from "@/lib/schema";

type BeadNodeData = {
  bead: Bead;
  onOpen: (id: string) => void;
  horizontal?: boolean;
  outsideEpic?: boolean;
};

const SpotlightContext = React.createContext<{ selected: string | null; active: Set<string> | null }>({ selected: null, active: null });
const MeasurementContext = React.createContext<(id: string, height: number) => void>(() => {});

function BeadNode({ data }: NodeProps) {
  const { bead, onOpen, horizontal, outsideEpic } = data as unknown as BeadNodeData;
  const { selectedBeadId, selectBead } = useApp();
  const spotlight = React.useContext(SpotlightContext);
  const measure = React.useContext(MeasurementContext);
  const element = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(() => measure(bead.id, node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [bead.id, measure]);
  return (
    <div
      ref={element}
      style={{
        opacity: !spotlight.active || spotlight.active.has(bead.id) ? 1 : 0.2,
        outline: spotlight.active && spotlight.selected === bead.id ? "2.5px solid var(--brand)" : undefined,
        outlineOffset: 3,
      }}
      role="button"
      tabIndex={0}
      data-keyboard-bead-id={bead.id}
      data-epic-scope={outsideEpic ? "outside" : "inside"}
      aria-current={selectedBeadId === bead.id ? "true" : undefined}
      onFocus={() => selectBead(bead.id)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(bead.id); }
      }}
      onClick={() => {
        selectBead(bead.id);
        onOpen(bead.id);
      }}
      className={`w-[170px] cursor-pointer rounded-[11px] border bg-[var(--surface)] p-[9px_11px] shadow-[var(--shadow)] hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-lg)] focus-visible:outline-none ${
        selectedBeadId === bead.id
          ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/30"
          : "border-border"
      }`}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        style={{ background: "var(--text-3)" }}
      />
      <div className="mb-[5px] flex items-center gap-[6px]">
        <span className="h-2 w-2 rounded-full" style={{ background: catColor(bead.status) }} />
        <span className="min-w-0 truncate font-mono text-[10.5px] text-[var(--text-3)]" title={bead.id}>{bead.id}</span>
        <span className="flex-1" />
        <Icon name={typeIconName(bead.issue_type)} size={12} style={{ color: typeColor(bead.issue_type) }} />
      </div>
      {outsideEpic && (
        <div className="mb-[5px] w-fit rounded-full bg-[var(--surface-3)] px-[6px] py-[2px] text-[9px] font-[650] uppercase tracking-[.04em] text-[var(--text-3)]">
          Outside epic
        </div>
      )}
      <div className="break-words text-[12px] font-[550] leading-[1.3] text-[var(--text)] [overflow-wrap:anywhere] [text-wrap:pretty]">
        {bead.title.replace(/\s*\([^)]*\)\s*/, "")}
      </div>
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        style={{ background: "var(--text-3)" }}
      />
    </div>
  );
}

function EpicNode({ data }: NodeProps) {
  const { bead, onOpen, completed, total } = data as unknown as BeadNodeData & { completed: number; total: number };
  const spotlight = React.useContext(SpotlightContext);
  return (
    <div className="h-full w-full rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-2)]" data-epic-container={bead.id}>
      <Handle type="target" position={Position.Left} style={{ top: 45 }} />
      <button type="button" onClick={() => onOpen(bead.id)}
        data-keyboard-bead-id={bead.id}
        style={{ opacity: !spotlight.active || spotlight.active.has(bead.id) ? 1 : 0.2 }}
        className="nodrag flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left text-[var(--text)]"
        aria-label={`Open epic ${bead.title}`}>
        <span className="text-xs text-[var(--text-3)]">Epic · {bead.id} · {completed}/{total} completed</span>
        <span className="line-clamp-2 text-sm font-semibold">{bead.title}</span>
      </button>
      <Handle type="source" position={Position.Right} style={{ top: 45 }} />
    </div>
  );
}

const nodeTypes = { bead: BeadNode, epic: EpicNode };

export function GraphView() {
  const { beads, openDetail, readOnly } = useApp();
  const { hideCompleted, setHideCompleted } = useGraphPrefs();
  const [epicId, setEpicId] = React.useState("");
  const [liveOnly, setLiveOnly] = React.useState(false);
  const [spotlight, setSpotlight] = React.useState(false);
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [heights, setHeights] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  const measure = React.useCallback((id: string, height: number) => {
    if (height <= 0) return;
    setHeights(current => current.get(id) === height ? current : new Map(current).set(id, height));
  }, []);
  const activateNode = React.useCallback((id: string) => {
    if (spotlight) setFocusId(id);
    else openDetail(id);
  }, [spotlight, openDetail]);
  const addDep = useAddDep();
  // Recenter/fit the graph on the current nodes (bead mpe).
  const rf = React.useRef<ReactFlowInstance | null>(null);
  const center = React.useCallback(() => rf.current?.fitView({ padding: 0.2, minZoom: 0.02, duration: 400 }), []);

  const epics = React.useMemo(
    () =>
      beads
        .filter(
          (bead) =>
            bead.issue_type === "epic" && !(bead.labels ?? []).includes("archived"),
        )
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)),
    [beads],
  );
  const effectiveEpicId = epics.some((epic) => epic.id === epicId) ? epicId : "";

  const scope = React.useMemo(() => graphScope(beads, effectiveEpicId, hideCompleted, liveOnly),
    [beads, effectiveEpicId, hideCompleted, liveOnly]);
  const nodes = React.useMemo(() => containerLayout(scope.visible, scope.all, activateNode, scope.outsideIds, heights),
    [scope, activateNode, heights]);
  const edges = React.useMemo(() => graphEdges(scope.visible), [scope]);
  const considered = scope.considered;
  // Fit after measured layout settles, never on spotlight/selection changes.
  React.useEffect(() => {
    const timer = setTimeout(() => { void rf.current?.fitView({ padding: 0.2, minZoom: 0.02 }); }, 100);
    return () => clearTimeout(timer);
  }, [scope, heights]);
  const hidden = Math.max(0, considered - nodes.length);
  const focus = React.useMemo(() => {
    if (!spotlight || !focusId || !nodes.some(n => n.id === focusId)) return null;
    return graphNeighborhood(beads, new Set(nodes.map(n => n.id)), focusId);
  }, [beads, nodes, spotlight, focusId]);
  // Keep React Flow node objects stable while highlighting. Replacing raw
  // nodes discards their measured dimensions and briefly hides click targets.
  const spotlightContext = React.useMemo(() => ({ selected: focusId, active: focus?.all ?? null }), [focusId, focus]);
  const shownEdges = React.useMemo(() => focus ? edges.map(e => {
    const lit = focus.edgeIds.has(e.id) && focus.all.has(e.source) && focus.all.has(e.target);
    return { ...e, style: { ...e.style, opacity: lit ? 1 : 0.12 }, animated: lit && e.animated };
  }) : edges, [edges, focus]);


  const onConnect = React.useCallback(
    (c: Connection) => {
      if (readOnly) return;
      if (c.source && c.target && c.source !== c.target) {
        const [id, dependsOnId] = [c.target, c.source];
        addDep.mutate({ id, dependsOnId, type: "blocks" });
      }
    },
    [addDep, readOnly],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="view-toolbar">
        <div className="flex-1">
          <h1 className="m-0 text-base font-[650] tracking-[-.01em]">Dependency graph</h1>
          <span className="hidden text-[11.5px] text-[var(--text-3)] md:inline">
            {effectiveEpicId
              ? spotlight
                ? "Left → right: prerequisite → dependent · select to spotlight active blocking chains; double-click for details"
                : readOnly
                  ? "Left → right: prerequisite → dependent · select a bead to view its details"
                  : "Left → right: prerequisite → dependent · drag a prerequisite onto its dependent"
              : spotlight
                ? "Select a bead to highlight active blocking chains; double-click for details"
                : readOnly
                  ? "Select a bead to view its details"
                  : "Left → right: prerequisite → dependent · drag a prerequisite onto its dependent"}
            {" · "}{nodes.length} beads shown
            {hidden > 0 && (
              <>
                {" · "}
                <span title="Adjust Hide completed and Live dependencies only to include more beads.">
                  {hidden} hidden by filter
                </span>
              </>
            )}
          </span>
          <p className="text-xs text-[var(--text-3)] md:hidden">{nodes.length} shown · drag to pan, pinch to zoom</p>
        </div>
        <select
          aria-label="Graph scope"
          value={effectiveEpicId}
          onChange={(event) => {
            setEpicId(event.target.value);
            setFocusId(null);
          }}
          title="Scope the graph to an epic and its descendants"
          className="h-9 min-w-0 max-w-full flex-1 cursor-pointer rounded-[9px] border border-border bg-[var(--surface-2)] px-[10px] text-[12.5px] font-[550] text-[var(--text-2)] outline-none hover:bg-[var(--surface-3)] md:max-w-[280px]"
        >
          <option value="">All beads</option>
          {epics.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.id} · {epic.title}
            </option>
          ))}
        </select>
        <ResponsiveControls title="Graph options" count={Number(hideCompleted) + Number(liveOnly) + Number(spotlight)}>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-2)]">
          <input type="checkbox" checked={hideCompleted} className="accent-[var(--brand)]"
            onChange={e => { setHideCompleted(e.target.checked); setFocusId(null); }} />
          Hide completed
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-2)]">
          <input type="checkbox" checked={spotlight} className="accent-[var(--brand)]"
            onChange={e => { setSpotlight(e.target.checked); setFocusId(null); }} />
          Spotlight dependencies
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-2)]">
          <input
            type="checkbox"
            checked={liveOnly}
            onChange={(e) => { setLiveOnly(e.target.checked); setFocusId(null); }}
            className="accent-[var(--brand)]"
          />
          Live dependencies only
        </label>
        </ResponsiveControls>
        <button
          onClick={center}
          title={effectiveEpicId ? "Fit selected epic and its dependencies" : "Center the graph on all issues"}
          className="flex h-9 flex-shrink-0 items-center gap-[6px] rounded-[9px] border border-border bg-[var(--surface-2)] px-[12px] text-[12.5px] font-[550] text-[var(--text-2)] hover:bg-[var(--surface-3)]"
        >
          <Icon name="target" size={15} />
          <span>{effectiveEpicId ? "Fit epic" : "Center"}</span>
        </button>
        {spotlight && (
          <div className="flex h-9 basis-full items-center">
            {focus && focusId ? (
              <button onClick={() => setFocusId(null)} title="Clear the dependency spotlight"
                className="flex h-9 items-center gap-2 rounded-[9px] bg-[var(--brand-weak)] px-3 text-[12px] text-[var(--brand)]">
                <span className="font-mono">{focusId}</span>
                <span>{focus.up} upstream · {focus.down} downstream</span>
                <Icon name="x" size={13} />
              </button>
            ) : <span className="text-[12px] text-[var(--text-3)]">Choose a bead to highlight its blocking chains.</span>}
          </div>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <MeasurementContext.Provider value={measure}>
        <SpotlightContext.Provider value={spotlightContext}>
        <ReactFlow
          key={`${effectiveEpicId || "all"}:${liveOnly}:${hideCompleted}`}
          nodes={nodes}
          edges={shownEdges}
          zoomOnDoubleClick={!spotlight}
          onPaneClick={() => setFocusId(null)}
          onNodeDoubleClick={(_, node) => { if (spotlight) openDetail(node.id); }}
          nodeTypes={nodeTypes}
          nodesConnectable={!readOnly}
          defaultEdgeOptions={{ zIndex: 1 }}
          onConnect={onConnect}
          onInit={(inst) => {
            rf.current = inst;
          }}
          minZoom={0.02}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.02 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} color="var(--border)" />
          <Controls fitViewOptions={{ padding: 0.2, minZoom: 0.02 }} />
        </ReactFlow>
        </SpotlightContext.Provider>
        </MeasurementContext.Provider>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-[360px] rounded-[12px] border border-border bg-[var(--surface)] p-[16px_18px] text-center shadow-[var(--shadow)]">
              <div className="text-[13px] font-[650] text-[var(--text)]">
                {liveOnly && considered > 0 ? "No live dependencies" : "No beads to show"}
              </div>
              <p className="m-0 mt-[6px] text-[12px] leading-[1.5] text-[var(--text-2)]">
                {considered === 0
                  ? "There are no non-archived beads in this project."
                  : "The current filter hides all beads. Show all beads to inspect completed work or create new dependencies."}
              </p>
              {considered > 0 && (
                <button
                  onClick={() => { setLiveOnly(false); setHideCompleted(false); }}
                  className="mt-3 rounded-lg border border-border px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)]"
                >
                  Show all beads
                </button>
              )}
            </div>
          </div>
        )}
        <div className="graph-legend pointer-events-none absolute bottom-[18px] left-1/2 flex -translate-x-1/2 gap-[18px] rounded-[11px] border border-border bg-[var(--surface)] p-[9px_16px] text-[11.5px] text-[var(--text-2)] shadow-[var(--shadow)]">
          <span className="flex items-center gap-[6px]">
            <span className="h-[2px] w-[18px] bg-[#ef4444]" />
            blocks
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="h-[2px] w-[18px] bg-[var(--text-3)]" />
            epic boundary
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="h-0 w-[18px] border-t-2 border-dashed border-[var(--brand)]" />
            related
          </span>
        </div>
      </div>
    </div>
  );
}
