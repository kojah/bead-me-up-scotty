"use client";
import * as React from "react";
import type { GraphBox } from "@/lib/graph-routing";
import { readableLinks, routeReadableLinks } from "@/lib/readable-connections";
import type { Bead } from "@/lib/schema";

function measureNodes(root: HTMLElement) {
  const origin = root.getBoundingClientRect();
  const boxes = new Map<string, GraphBox>();
  const obstacles: GraphBox[] = [];
  for (const node of root.querySelectorAll<HTMLElement>("[data-connection-obstacle]")) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const box = {
      x: rect.x - origin.x,
      y: rect.y - origin.y,
      width: rect.width,
      height: rect.height,
    };
    if (node.dataset.connectionNode) boxes.set(node.dataset.connectionNode, box);
    else obstacles.push(box);
  }
  return { boxes, obstacles };
}

export function ReadableConnections({
  beads,
  children,
}: {
  beads: Bead[];
  children: React.ReactNode;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const marker = React.useId();
  const links = React.useMemo(() => readableLinks(beads), [beads]);
  const [routes, setRoutes] = React.useState<ReturnType<typeof routeReadableLinks>>([]);
  React.useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { boxes, obstacles } = measureNodes(element);
        setRoutes(routeReadableLinks(links, boxes, obstacles));
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
        characterData: true,
      });
    observeNodes();
    return () => {
      mutations.disconnect();
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [links]);
  const titles = new Map(beads.map((b) => [b.id, b.title]));
  return (
    <>
      <p className="mb-3 text-xs text-[var(--text-3)]" data-connection-summary>
        {routes.length} of {links.length} dependency connections shown (current filter).
      </p>
      <div ref={root} className="relative p-3" data-readable-connections>
        <div ref={content}>{children}</div>
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
              d={route.path}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeDasharray={route.types.includes("blocks") ? undefined : "5 4"}
              markerEnd={`url(#${marker})`}
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
