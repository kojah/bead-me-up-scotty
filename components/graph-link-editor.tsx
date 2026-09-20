"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { useAddDep } from "@/hooks/use-beads";

/** Explicit endpoints work with touch and keyboard, without drag-only handles. */
export function GraphLinkEditor() {
  const { beads, readOnly } = useApp();
  const add = useAddDep();
  const [source, setSource] = React.useState("");
  const [target, setTarget] = React.useState("");
  const available = beads.filter((b) => !b.labels.includes("archived"));
  const dependent = available.find((b) => b.id === target);
  const duplicate = dependent?.dependencies.some((d) => d.depends_on_id === source);
  const valid =
    source !== target && available.some((b) => b.id === source) && !!dependent && !duplicate;
  if (readOnly) return null;
  return (
    <details className="min-w-0 rounded-lg border border-border p-3">
      <summary className="min-h-11 cursor-pointer content-center text-sm">Add dependency</summary>
      <form
        className="flex min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || readOnly || add.isPending) return;
          add.mutate(
            { id: target, dependsOnId: source, type: "blocks" },
            {
              onSuccess: () => {
                setSource("");
                setTarget("");
              },
            },
          );
        }}
      >
        <p className="text-xs text-[var(--text-3)]">
          The prerequisite blocks the dependent. Neither task’s status will change.
        </p>
        {[
          { label: "Prerequisite", value: source, set: setSource },
          { label: "Dependent", value: target, set: setTarget },
        ].map(({ label, value, set }) => (
          <label key={label} className="flex min-w-0 flex-col gap-1 text-xs">
            {label}
            <select
              aria-label={label}
              className="control-button w-full min-w-0"
              value={value}
              onChange={(e) => set(e.target.value)}
              required
            >
              <option value="">Choose a task or epic</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} · {b.title}
                </option>
              ))}
            </select>
          </label>
        ))}
        {duplicate && (
          <p role="status" className="text-xs">
            These beads already have a relationship. Edit it in task details.
          </p>
        )}
        <button type="submit" className="control-button" disabled={!valid || add.isPending}>
          {add.isPending ? "Adding…" : "Create dependency"}
        </button>
      </form>
    </details>
  );
}
