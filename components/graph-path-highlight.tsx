"use client";
import * as React from "react";
import type { ReadableLink } from "@/lib/readable-connections";

export function pathNeighborhood(id: string, links: ReadableLink[]) {
  return new Set([...walk(id, links, false), ...walk(id, links, true)]);
}
function walk(id: string, links: ReadableLink[], reverse: boolean) {
  const seen = new Set([id]),
    queue = [id];
  for (let i = 0; i < queue.length; i++)
    for (const link of links) {
      const from = reverse ? link.target : link.source,
        to = reverse ? link.source : link.target;
      if (from !== queue[i] || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  return seen;
}

export const GraphPathContext = React.createContext<{
  active: Set<string> | null;
  pinned: string | null;
  hover: (id: string | null) => void;
  focus: (id: string | null) => void;
  toggle: (id: string) => void;
} | null>(null);

export function usePathHighlight(id: string, preview = true) {
  const context = React.useContext(GraphPathContext);
  return {
    context,
    style: { opacity: context?.active && !context.active.has(id) ? 0.3 : 1 },
    onPointerEnter: (e: React.PointerEvent) => {
      if (preview && e.pointerType === "mouse") context?.hover(id);
    },
    onPointerLeave: () => context?.hover(null),
    onPointerDownCapture: () => context?.focus(null),
    onFocusCapture: (e: React.FocusEvent) => {
      if (preview && e.target instanceof HTMLElement && e.target.matches(":focus-visible"))
        context?.focus(id);
    },
    onBlurCapture: (e: React.FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget)) context?.focus(null);
    },
  };
}

export function HighlightPathButton({ id, title }: { id: string; title: string }) {
  const context = React.useContext(GraphPathContext);
  if (!context) return null;
  return (
    <button
      type="button"
      aria-label={`Highlight path for ${title}`}
      aria-pressed={context.pinned === id}
      onClick={() => context.toggle(id)}
      className="min-h-11 text-xs text-[var(--brand)] hover:underline"
    >
      Highlight path
    </button>
  );
}
