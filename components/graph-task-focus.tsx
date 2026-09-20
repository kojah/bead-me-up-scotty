"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { GraphTaskCard } from "@/components/graph-task-card";
import { epicOwners } from "@/lib/graph-containers";
import type { GraphDirection } from "@/lib/graph-direction";
import { type TaskRelation, taskRelations } from "@/lib/readable-graph";

export function GraphTaskFocus({
  id,
  onFocus,
  onBack,
  direction,
}: {
  id: string;
  onFocus: (id: string) => void;
  onBack: () => void;
  direction: GraphDirection;
}) {
  const { beads } = useApp();
  const relations = React.useMemo(() => taskRelations(beads, id), [beads, id]);
  const parent = React.useMemo(() => {
    const all = beads.filter((b) => !b.labels.includes("archived"));
    const owner = epicOwners(all).get(id);
    return all.find((b) => b.id === owner);
  }, [beads, id]);
  return (
    <section aria-label="Task neighborhood" className="min-w-0">
      <button type="button" className="control-button mb-4" onClick={onBack}>
        ← Back to epic view
      </button>
      {!relations.bead ? (
        <p role="status">
          This task is no longer available. Return to the epic view to choose another.
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-[var(--text-3)]">
            Immediate dependencies only, including completed tasks. Parent-child links are shown as
            epic membership.
          </p>
          <div
            className={`task-neighborhood-grid grid min-w-0 grid-cols-1 items-start gap-4 ${direction === "right" ? "xl:grid-cols-3" : ""}`}
          >
            <RelationGroup
              title="Prerequisites"
              relations={relations.prerequisites}
              onFocus={onFocus}
              empty="No prerequisites"
            />
            <section aria-label="Selected task" className="min-w-0">
              <h2 className="mb-3 text-sm font-semibold">Selected task</h2>
              <GraphTaskCard bead={relations.bead} onFocus={onFocus} parent={parent} focused />
            </section>
            <RelationGroup
              title="Dependents"
              relations={relations.dependents}
              onFocus={onFocus}
              empty="No dependents"
            />
          </div>
          {relations.related.length > 0 && (
            <div className="mt-6">
              <RelationGroup
                title="Other relationships"
                relations={relations.related}
                onFocus={onFocus}
                empty=""
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RelationGroup({
  title,
  relations,
  onFocus,
  empty,
}: {
  title: string;
  relations: TaskRelation[];
  onFocus: (id: string) => void;
  empty: string;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="mb-3 text-sm font-semibold">
        {title} <span className="font-normal text-[var(--text-3)]">({relations.length})</span>
      </h2>
      <div className="grid gap-3">
        {relations.map((relation) => (
          <div key={relation.id} className="min-w-0">
            <p className="mb-1 break-words text-xs text-[var(--text-3)]">
              {relation.types.join(" · ")}
            </p>
            {relation.bead ? (
              <GraphTaskCard bead={relation.bead} onFocus={onFocus} />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm">
                <span className="break-all font-mono">{relation.id}</span>
                <p className="mt-1 text-xs text-[var(--text-3)]">
                  Unavailable task (missing or archived)
                </p>
              </div>
            )}
          </div>
        ))}
        {relations.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-[var(--text-3)]">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}
