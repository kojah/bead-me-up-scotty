"use client";
import * as React from "react";
import type { GraphDirection } from "@/lib/graph-direction";
import type { GraphBox } from "@/lib/graph-routing";
import { isBlockingLink, readableLinks, routeReadableLinks } from "@/lib/readable-connections";
import type { Bead } from "@/lib/schema";
import { GraphPathContext, pathNeighborhood } from "./graph-path-highlight";

function measureNodes(root: HTMLElement, direction: GraphDirection, zoom: number) {
  const origin = root.getBoundingClientRect();
  const boxes = new Map<string, GraphBox>();
  const obstacles: GraphBox[] = [];
  const ports = new Map<string, GraphBox>();
  for (const node of root.querySelectorAll<HTMLElement>("[data-connection-obstacle]")) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const box = {
      x: (rect.x - origin.x) / zoom,
      y: (rect.y - origin.y) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
    if (node.dataset.connectionNode) boxes.set(node.dataset.connectionNode, box);
    else obstacles.push(box);
  }
  for (const [id, box] of boxes) ports.set(id, box);
  if (direction === "down")
    for (const epic of root.querySelectorAll<HTMLElement>("[data-readable-epic]")) {
      const rect = epic.getBoundingClientRect();
      ports.set(epic.dataset.readableEpic!, {
        x: (rect.x - origin.x) / zoom,
        y: (rect.y - origin.y) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      });
    }
  return { boxes, obstacles, ports };
}

export function ReadableConnections({
  beads,
  children,
  direction,
  zoom = 1,
  showRelated = false,
}: {
  beads: Bead[];
  children: React.ReactNode;
  direction: GraphDirection;
  zoom?: number;
  showRelated?: boolean;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const marker = React.useId();
  const links = React.useMemo(() => readableLinks(beads, showRelated), [beads, showRelated]);
  const [routes, setRoutes] = React.useState<ReturnType<typeof routeReadableLinks>>([]);
  const [preview, setPreview] = React.useState<{ id: string; kind: "hover" | "focus" } | null>(
    null,
  );
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState<Set<string>>(() => new Set());
  const activeId = [pinned, preview?.id].find((id) => id && visible.has(id)) ?? null;
  const updatePreview = (kind: "hover" | "focus", id: string | null) =>
    setPreview((current) => (id ? { id, kind } : current?.kind === kind ? null : current));
  React.useEffect(() => {
    if (pinned && !visible.has(pinned)) setPinned(null);
    if (preview && !visible.has(preview.id)) setPreview(null);
  }, [pinned, preview, visible]);
  const active = React.useMemo(
    () => (activeId ? pathNeighborhood(activeId, routes.filter(isBlockingLink)) : null),
    [activeId, routes],
  );
  const clear = () => {
    setPinned(null);
    setPreview(null);
  };
  React.useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { boxes, obstacles, ports } = measureNodes(element, direction, zoom);
        setVisible(new Set(boxes.keys()));
        setRoutes(routeReadableLinks(links, boxes, obstacles, direction, ports));
      });
    };
    const observer = new ResizeObserver(measure);
    const observeNodes = () => {
      observer.disconnect();
      observer.observe(element);
      for (const node of element.querySelectorAll("[data-connection-obstacle]"))
        observer.observe(node);
      measure();
    };
    const mutations = new MutationObserver(observeNodes);
    if (content.current)
      mutations.observe(content.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden"],
        characterData: true,
      });
    observeNodes();
    return () => {
      mutations.disconnect();
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [links, direction, zoom]);
  const titles = new Map(beads.map((b) => [b.id, b.title]));
  return (
    <>
      <p className="mb-3 text-xs text-[var(--text-3)]" data-connection-summary>
        {routes.length} of {links.length} dependency connections shown (current filter).
        {showRelated && " Dashed gray links are other relationships, not execution order."}
      </p>
      <div className="mb-3 flex min-h-11 items-center gap-3 text-xs text-[var(--text-3)]">
        <span className="min-w-0 flex-1">
          Hover a task or use keyboard focus to preview its path. “Highlight path” pins a task or
          epic.
        </span>
        <button type="button" className="control-button" disabled={!activeId} onClick={clear}>
          Clear path
        </button>
      </div>
      <div ref={root} className="relative p-3" data-readable-connections data-direction={direction}>
        <GraphPathContext.Provider
          value={{
            active,
            pinned: activeId === pinned ? pinned : null,
            hover: (id) => updatePreview("hover", id),
            focus: (id) => updatePreview("focus", id),
            toggle: (id) => {
              setPreview(null);
              setPinned((current) => (current === id ? null : id));
            },
          }}
        >
          <div
            ref={content}
            onKeyDown={(e) => {
              if (e.key === "Escape") clear();
            }}
          >
            {children}
          </div>
        </GraphPathContext.Provider>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand)" />
            </marker>
          </defs>
          {routes.map((route) => (
            <path
              key={JSON.stringify([route.source, route.target])}
              data-readable-edge
              data-source={route.source}
              data-target={route.target}
              data-relationship={isBlockingLink(route) ? "blocking" : "other"}
              d={route.path}
              fill="none"
              stroke={isBlockingLink(route) ? "var(--brand)" : "var(--text-3)"}
              strokeWidth="1.5"
              opacity={active && !(active.has(route.source) && active.has(route.target)) ? 0.12 : 1}
              data-highlighted={
                active ? String(active.has(route.source) && active.has(route.target)) : undefined
              }
              strokeLinejoin="round"
              strokeDasharray={route.types.includes("blocks") ? undefined : "5 4"}
              markerEnd={isBlockingLink(route) ? `url(#${marker})` : undefined}
            >
              <title>
                {titles.get(route.source)} → {titles.get(route.target)} ({route.types.join(", ")})
              </title>
            </path>
          ))}
        </svg>
      </div>
      <ul className="sr-only" aria-label="Visible dependency connections">
        {routes.map((route) => (
          <li key={JSON.stringify([route.source, route.target])}>
            {titles.get(route.source)} → {titles.get(route.target)} ({route.types.join(", ")})
          </li>
        ))}
      </ul>
    </>
  );
}
