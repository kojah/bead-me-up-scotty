"use client";
import { useApp } from "@/components/app-context";
import { HighlightPathButton, usePathHighlight } from "@/components/graph-path-highlight";
import { catColor, statusLabel } from "@/lib/beads-view";
import type { Bead } from "@/lib/schema";

export function GraphTaskCard({
  bead,
  onFocus,
  focused = false,
  parent,
}: {
  bead: Bead;
  onFocus: (id: string) => void;
  focused?: boolean;
  parent?: Bead;
}) {
  const { openDetail, selectBead } = useApp();
  const { context: _context, ...highlight } = usePathHighlight(bead.id);
  const prerequisites = new Set(
    bead.dependencies
      .filter((d) => ["blocks", "waits-for", "conditional-blocks"].includes(d.type))
      .map((d) => d.depends_on_id),
  );
  return (
    <article
      data-readable-task={bead.id}
      data-connection-node={bead.id}
      data-connection-obstacle
      {...highlight}
      className={`min-w-0 rounded-xl border p-4 ${focused ? "border-[var(--brand)] bg-[var(--brand-weak)]" : "border-border bg-[var(--surface)]"}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: catColor(bead.status) }}
        />
        <span>{statusLabel(bead.status)}</span>
        <span className="break-all font-mono">{bead.id}</span>
      </div>
      {parent && (
        <p className="mt-2 break-words text-xs text-[var(--text-3)] [overflow-wrap:anywhere]">
          Epic: {parent.title}
        </p>
      )}
      <button
        type="button"
        data-keyboard-bead-id={bead.id}
        onFocus={() => selectBead(bead.id)}
        onClick={() => openDetail(bead.id)}
        aria-label={`Open task ${bead.title}`}
        className="my-2 block min-h-11 w-full break-words text-left text-sm font-semibold leading-relaxed text-[var(--text)] [overflow-wrap:anywhere] hover:underline"
      >
        {bead.title}
      </button>
      {focused ? (
        <button type="button" className="control-button" onClick={() => openDetail(bead.id)}>
          View task details
        </button>
      ) : (
        <button
          type="button"
          className="min-h-11 text-left text-xs text-[var(--brand)] hover:underline"
          onClick={() => onFocus(bead.id)}
          aria-label={`Focus dependencies for ${bead.title}`}
        >
          Focus dependencies
          {prerequisites.size > 0
            ? ` · ${prerequisites.size} prerequisite${prerequisites.size === 1 ? "" : "s"}`
            : ""}{" "}
          →
        </button>
      )}
      {!focused && (
        <div>
          <HighlightPathButton id={bead.id} title={bead.title} />
        </div>
      )}
    </article>
  );
}
