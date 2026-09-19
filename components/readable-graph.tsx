"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { GraphTaskCard } from "@/components/graph-task-card";
import { GraphTaskFocus } from "@/components/graph-task-focus";
import { useGraphPrefs } from "@/hooks/use-graph-prefs";
import { useMobile } from "@/hooks/use-mobile";
import { graphScope } from "@/lib/graph-model";
import { readableGraph } from "@/lib/readable-graph";
import type { Bead } from "@/lib/schema";

type Props = {
  epicId: string;
  setEpicId: (id: string) => void;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  focusId: string | null;
  setFocusId: (id: string | null) => void;
};
type Model = ReturnType<typeof readableGraph>;
const grid =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] items-start gap-4";

export function ReadableGraph(props: Props) {
  const { beads, selectBead } = useApp();
  const { hideCompleted, setHideCompleted } = useGraphPrefs();
  const mobile = useMobile();
  const epics = React.useMemo(
    () =>
      beads
        .filter((b) => b.issue_type === "epic" && !b.labels.includes("archived"))
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)),
    [beads],
  );
  const epicId = epics.some((b) => b.id === props.epicId) ? props.epicId : "";
  const scope = React.useMemo(
    () => graphScope(beads, epicId, hideCompleted, false),
    [beads, epicId, hideCompleted],
  );
  const model = React.useMemo(
    () => readableGraph(scope.visible, scope.all, scope.outsideIds),
    [scope],
  );
  const scroller = React.useRef<HTMLDivElement>(null);
  const overviewScroll = React.useRef(0);
  const focus = (id: string) => {
    if (!props.focusId) overviewScroll.current = scroller.current?.scrollTop ?? 0;
    props.setFocusId(id);
    selectBead(id);
    scroller.current?.scrollTo({ top: 0 });
  };
  const back = () => {
    props.setFocusId(null);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: overviewScroll.current }));
  };
  const toggle = (id: string) =>
    props.setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // On phones only collapse sibling branches, never the ancestor being read.
      if (mobile)
        for (const open of next)
          if (model.owners.get(open) === model.owners.get(id)) next.delete(open);
      next.add(id);
      return next;
    });
  const tree = { model, expanded: props.expanded, toggle, onFocus: focus, depth: 0 };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-readable-graph>
      <header className="view-toolbar">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">Dependency graph</h1>
          <p className="text-xs text-[var(--text-3)]">
            {props.focusId
              ? "Task focus · immediate prerequisites and dependents"
              : "Expand epics to browse · focus a task to follow its dependencies"}
          </p>
        </div>
        <select
          aria-label="Graph scope"
          value={epicId}
          onChange={(event) => {
            props.setEpicId(event.target.value);
            props.setFocusId(null);
            scroller.current?.scrollTo({ top: 0 });
          }}
          className="h-11 min-w-0 max-w-full rounded-lg border border-border bg-[var(--surface-2)] px-3 text-sm md:max-w-[300px]"
        >
          <option value="">All beads</option>
          {epics.map((b) => (
            <option value={b.id} key={b.id}>
              {b.id} · {b.title}
            </option>
          ))}
        </select>
        {!props.focusId && (
          <>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              Hide completed
            </label>
            <button
              type="button"
              className="control-button"
              onClick={() => props.setExpanded(new Set())}
            >
              Collapse all
            </button>
          </>
        )}
      </header>
      <div
        ref={scroller}
        className="readable-graph-scroll bd-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-6"
      >
        {props.focusId ? (
          <GraphTaskFocus id={props.focusId} onFocus={focus} onBack={back} />
        ) : (
          <>
            <p className="mb-4 text-xs text-[var(--text-3)]">
              Cards stay at reading size. Order follows dependencies where possible; adjacent cards
              do not imply a link. Use Full graph for the complete edge map.
            </p>
            <ReadableItems items={model.children.get("") ?? []} {...tree} />
            {model.outside.length > 0 && (
              <section aria-label="Outside epic" className="mt-6">
                <h2 className="mb-3 text-sm font-semibold">Outside epic · linked context</h2>
                <div className={grid}>
                  {model.outside.map((b) => (
                    <GraphTaskCard key={b.id} bead={b} onFocus={focus} />
                  ))}
                </div>
              </section>
            )}
            {scope.visible.length === 0 && (
              <div className="rounded-xl border border-border bg-[var(--surface)] p-6 text-sm">
                <p>No beads to show{hideCompleted ? " with completed work hidden" : ""}.</p>
                {hideCompleted && (
                  <button
                    type="button"
                    className="control-button mt-3"
                    onClick={() => setHideCompleted(false)}
                  >
                    Show completed beads
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type TreeProps = {
  depth: number;
  model: Model;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onFocus: (id: string) => void;
};
function ReadableItems({ items, ...tree }: TreeProps & { items: Bead[] }) {
  return (
    <div className={grid}>
      {items.map((bead) =>
        bead.issue_type === "epic" ? (
          <EpicBranch key={bead.id} bead={bead} {...tree} />
        ) : (
          <GraphTaskCard key={bead.id} bead={bead} onFocus={tree.onFocus} />
        ),
      )}
    </div>
  );
}

function EpicBranch({ bead, ...tree }: TreeProps & { bead: Bead }) {
  const { openDetail } = useApp();
  const open = tree.expanded.has(bead.id);
  const progress = tree.model.progress.get(bead.id) ?? { total: 0, completed: 0 };
  const children = tree.model.children.get(bead.id) ?? [];
  const contentId = React.useId();
  return (
    <section
      data-readable-epic={bead.id}
      className={`min-w-0 rounded-xl border border-border bg-[var(--surface-2)] ${open && tree.depth === 0 ? "col-span-full" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${open ? "Collapse" : "Expand"} epic ${bead.title}`}
        onClick={() => tree.toggle(bead.id)}
        className="flex min-h-11 w-full items-center gap-3 rounded-t-xl p-4 text-left hover:bg-[var(--surface-3)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block break-all font-mono text-xs text-[var(--text-3)]">
            Epic · {bead.id}
          </span>
          <span className="my-1 block break-words text-sm font-semibold [overflow-wrap:anywhere]">
            {bead.title}
          </span>
          <span className="text-xs text-[var(--text-3)]">
            {progress.completed} / {progress.total} tasks complete
          </span>
        </span>
        <span aria-hidden="true" className="text-xl text-[var(--text-3)]">
          {open ? "−" : "+"}
        </span>
      </button>
      <div id={contentId} hidden={!open} className="border-t border-border p-3 md:p-4">
        {open && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <button type="button" className="control-button" onClick={() => openDetail(bead.id)}>
                Epic details
              </button>
              <button
                type="button"
                className="control-button"
                onClick={() => tree.onFocus(bead.id)}
              >
                Epic dependencies
              </button>
            </div>
            {children.length ? (
              <ReadableItems items={children} {...tree} depth={tree.depth + 1} />
            ) : (
              <p className="text-sm text-[var(--text-3)]">
                No child tasks match the current filter.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
