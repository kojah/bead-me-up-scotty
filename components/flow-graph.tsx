"use client";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { GraphFullscreenButton, useGraphFullscreen } from "@/components/graph-fullscreen";
import { GraphLinkEditor } from "@/components/graph-link-editor";
import { useGraphDirection, useGraphPrefs } from "@/hooks/use-graph-prefs";
import { useMobile } from "@/hooks/use-mobile";
import { catColor, statusLabel } from "@/lib/beads-view";
import { buildFlowGraph, type FlowBead, type FlowDependency } from "@/lib/flow-graph";
import type { GraphDirection } from "@/lib/graph-direction";
import { graphScope } from "@/lib/graph-model";
import type { Bead } from "@/lib/schema";
import { cn } from "@/lib/utils";
import "@xyflow/react/dist/style.css";

function BeadNode({ data }: NodeProps<FlowBead>) {
  const { openDetail } = useApp();
  const { bead, direction, group, collapsed, count, toggle } = data;
  const down = direction === "down";
  const epic = bead.issue_type === "epic";
  return (
    <div
      className={cn(
        "pointer-events-auto h-full w-full rounded-lg border border-border",
        group ? "bg-[var(--brand-weak)]/30" : "bg-[var(--surface)] shadow-sm",
      )}
      data-flow-bead={bead.id}
      data-flow-group={group}
    >
      <div
        className={cn(
          "relative flex gap-2 px-3",
          group ? "h-10 items-center" : "h-full items-start py-2",
        )}
      >
        <Handle
          type="target"
          position={down ? Position.Top : Position.Left}
          isConnectable={false}
        />
        {epic ? (
          <button
            type="button"
            className="nodrag nopan shrink-0 p-1 text-[var(--text-3)]"
            onClick={toggle}
            aria-label={`${collapsed ? "Expand" : "Collapse"} epic ${bead.title}`}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </button>
        ) : (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ background: catColor(bead.status) }}
          />
        )}
        <button
          type="button"
          className="nodrag nopan min-w-0 flex-1 text-left"
          onClick={() => openDetail(bead.id)}
          aria-label={`Open ${epic ? "epic" : "task"} ${bead.title}`}
          title={bead.title}
        >
          <span
            className={cn(
              "block text-xs font-medium leading-4",
              group ? "truncate" : "line-clamp-2",
            )}
          >
            {bead.title}
          </span>
          {!group && (
            <span className="mt-1 block truncate font-mono text-[10px] text-[var(--text-3)]">
              {bead.id} · {statusLabel(bead.status)}
            </span>
          )}
        </button>
        {epic && <span className="shrink-0 text-[10px] text-[var(--text-3)]">{count} tasks</span>}
        <Handle
          type="source"
          position={down ? Position.Bottom : Position.Right}
          isConnectable={false}
        />
      </div>
    </div>
  );
}

function DependencyEdge(props: EdgeProps<FlowDependency>) {
  const [fallback] = getSmoothStepPath(props);
  return (
    <BaseEdge path={props.data?.path ?? fallback} markerEnd={props.markerEnd} style={props.style} />
  );
}

const nodeTypes = { bead: BeadNode };
const edgeTypes = { dependency: DependencyEdge };

function FitLayout() {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  React.useEffect(() => {
    if (!initialized || !width || !height) return;
    const frame = requestAnimationFrame(
      () => void fitView({ padding: 0.15, maxZoom: 1, duration: 150 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [initialized, fitView, width, height]);
  return null;
}

function FlowCanvas({
  visible,
  all,
  outsideIds,
  direction,
  includeRelated,
}: {
  visible: Bead[];
  all: Bead[];
  outsideIds: ReadonlySet<string>;
  direction: GraphDirection;
  includeRelated: boolean;
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const model = React.useMemo(
    () => buildFlowGraph(visible, all, outsideIds, collapsed, direction, includeRelated),
    [visible, all, outsideIds, collapsed, direction, includeRelated],
  );
  const toggle = React.useCallback(
    (id: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const nodes = React.useMemo(
    () =>
      model.nodes.map((node) => ({
        ...node,
        data: { ...node.data, toggle: () => toggle(node.id) },
      })),
    [model.nodes, toggle],
  );
  const layoutKey = JSON.stringify(nodes.map((node) => [node.id, node.position, node.style]));
  return (
    <div className="min-h-0 flex-1" data-flow-graph>
      <ReactFlow
        nodes={nodes}
        edges={model.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.05}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--text-3)" },
          style: { stroke: "var(--text-3)", strokeWidth: 1.5 },
          zIndex: 1,
        }}
        style={
          {
            "--xy-background-color": "var(--surface)",
            "--xy-controls-button-background-color": "var(--surface)",
            "--xy-controls-button-color": "var(--text)",
            "--xy-minimap-background-color": "var(--surface-2)",
          } as React.CSSProperties
        }
      >
        <FitLayout key={layoutKey} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => catColor((node.data as FlowBead["data"]).bead.status)}
          className="hidden md:block"
        />
        <Panel position="top-right" className="flex gap-2">
          <button type="button" className="control-button" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
          <button
            type="button"
            className="control-button"
            onClick={() =>
              setCollapsed(new Set(visible.filter((b) => b.issue_type === "epic").map((b) => b.id)))
            }
          >
            Collapse all
          </button>
        </Panel>
        {!nodes.length && <Panel position="top-center">No beads match the current filters.</Panel>}
      </ReactFlow>
    </div>
  );
}

export function FlowGraph() {
  const { beads } = useApp();
  const { direction, preference, setPreference } = useGraphDirection();
  const mobile = useMobile();
  const canvasDirection = preference === "auto" ? (mobile ? "down" : "right") : direction;
  const { hideCompleted, setHideCompleted } = useGraphPrefs();
  const fullscreenState = useGraphFullscreen();
  const [epicId, setEpicId] = React.useState("");
  const [liveOnly, setLiveOnly] = React.useState(false);
  const [includeRelated, setIncludeRelated] = React.useState(false);
  const epics = beads.filter(
    (bead) => bead.issue_type === "epic" && !bead.labels.includes("archived"),
  );
  const scope = React.useMemo(
    () => graphScope(beads, epicId, hideCompleted, liveOnly),
    [beads, epicId, hideCompleted, liveOnly],
  );
  return (
    <div
      ref={fullscreenState.graph}
      data-fullscreen={fullscreenState.fullscreen}
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        fullscreenState.fullscreen && "fixed inset-0 z-40 bg-[var(--surface)]",
      )}
    >
      <header className="view-toolbar">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">Dependency graph</h1>
          <p className="text-xs text-[var(--text-3)]">
            Drag to pan · scroll to zoom · click a title for details
          </p>
        </div>
        <select
          aria-label="Graph scope"
          className="control-button min-w-0 max-w-full md:max-w-[300px]"
          value={epicId}
          onChange={(event) => setEpicId(event.target.value)}
        >
          <option value="">All beads</option>
          {epics.map((bead) => (
            <option key={bead.id} value={bead.id}>
              {bead.id} · {bead.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Graph direction"
          className="control-button"
          value={preference}
          onChange={(event) => setPreference(event.target.value as "auto" | "down" | "right")}
        >
          <option value="auto">Auto direction</option>
          <option value="down">↓ Top to bottom</option>
          <option value="right">→ Left to right</option>
        </select>
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => setHideCompleted(event.target.checked)}
          />
          Hide completed
        </label>
        <GraphFullscreenButton {...fullscreenState} />
      </header>
      <details className="shrink-0 border-b border-border px-4 py-1">
        <summary className="min-h-11 cursor-pointer content-center text-sm">Graph options</summary>
        <div className="max-h-[40dvh] overflow-y-auto pb-3">
          <div className="flex flex-wrap gap-4 pb-2">
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={liveOnly}
                onChange={(event) => setLiveOnly(event.target.checked)}
              />
              Live dependencies only
            </label>
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={includeRelated}
                onChange={(event) => setIncludeRelated(event.target.checked)}
              />
              Show other relationships
            </label>
            <p className="content-center text-xs text-[var(--text-3)]">
              Epic borders show membership. Collapsing an epic combines its external dependency
              arrows.
            </p>
          </div>
          <GraphLinkEditor />
        </div>
      </details>
      <FlowCanvas {...scope} direction={canvasDirection} includeRelated={includeRelated} />
    </div>
  );
}
