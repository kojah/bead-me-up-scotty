"use client";
import * as React from "react";
import { useApp } from "@/components/app-context";
import { HighlightPathButton, usePathHighlight } from "@/components/graph-path-highlight";
import { GraphTaskCard } from "@/components/graph-task-card";
import { GraphTaskFocus } from "@/components/graph-task-focus";
import { ReadableConnections } from "@/components/readable-connections";
import { useGraphPrefs } from "@/hooks/use-graph-prefs";
import { useMobile } from "@/hooks/use-mobile";
import type { GraphDirection } from "@/lib/graph-direction";
import { alignedLevels } from "@/lib/graph-levels";
import { graphScope } from "@/lib/graph-model";
import { readableGraph } from "@/lib/readable-graph";
import type { Bead } from "@/lib/schema";

type Props = {
  direction: GraphDirection;
  epicId: string;
  setEpicId: (id: string) => void;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  focusId: string | null;
  setFocusId: (id: string | null) => void;
};
type Model = ReturnType<typeof readableGraph>;

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
  const tree = {
    model,
    expanded: props.expanded,
    toggle,
    onFocus: focus,
    depth: 0,
    direction: props.direction,
  };
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
          <GraphTaskFocus
            id={props.focusId}
            onFocus={focus}
            onBack={back}
            direction={props.direction}
          />
        ) : (
          <>
            <p className="mb-4 text-xs text-[var(--text-3)]">
              Arrows run from prerequisites to dependents. Epic borders mean membership, not a
              dependency. Expand epics to reveal child-task connections.
            </p>
            <ReadableConnections beads={scope.visible} direction={props.direction}>
              <ReadableItems
                items={[...(model.children.get("") ?? []), ...model.outside]}
                {...tree}
              />
            </ReadableConnections>
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
  direction: GraphDirection;
  depth: number;
  model: Model;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onFocus: (id: string) => void;
};
function ReadableItems({ items, ...tree }: TreeProps & { items: Bead[] }) {
  const mobile = useMobile();
  const { columns, rows } = alignedLevels(items, tree.model.visible, tree.model.owners);
  const element = React.useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = React.useState(false);
  React.useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setNarrow(node.clientWidth < (columns / 2) * 260));
    observer.observe(node);
    return () => observer.disconnect();
  }, [columns]);
  const single = mobile || narrow;
  const down = tree.direction === "down";
  return (
    <div
      ref={element}
      className={down ? "flex min-w-0 flex-col gap-12" : "flex w-max min-w-full items-start gap-12"}
      data-dependency-levels
    >
      {rows.map((row) => (
        <div
          key={row.map((e) => e.bead.id).join("|")}
          data-dependency-level
          className={
            down
              ? "grid min-w-0 items-start gap-y-12"
              : "flex w-max min-w-[320px] shrink-0 flex-col gap-12"
          }
          style={
            down
              ? {
                  gridTemplateColumns: single
                    ? "minmax(0,1fr)"
                    : `repeat(${columns},minmax(0,1fr))`,
                  columnGap: single ? 0 : 16,
                }
              : undefined
          }
        >
          {row.map(({ bead, column }) => (
            <div
              key={bead.id}
              className="min-w-0"
              style={
                down && !single
                  ? {
                      gridColumn:
                        bead.issue_type === "epic" && tree.expanded.has(bead.id)
                          ? "1 / -1"
                          : `${column + 1} / span 2`,
                    }
                  : undefined
              }
            >
              <ReadableItem bead={bead} {...tree} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReadableItem({ bead, ...tree }: TreeProps & { bead: Bead }) {
  if (tree.model.outsideIds.has(bead.id))
    return (
      <section aria-label="Outside epic">
        <p data-connection-obstacle className="mb-6 text-xs text-[var(--text-3)]">
          Outside epic · linked context
        </p>
        <GraphTaskCard bead={bead} onFocus={tree.onFocus} />
      </section>
    );
  return bead.issue_type === "epic" ? (
    <EpicBranch bead={bead} {...tree} />
  ) : (
    <GraphTaskCard bead={bead} onFocus={tree.onFocus} />
  );
}

function EpicBranch({ bead, ...tree }: TreeProps & { bead: Bead }) {
  const { context: _context, ...highlight } = usePathHighlight(bead.id);
  const { openDetail } = useApp();
  const open = tree.expanded.has(bead.id);
  const progress = tree.model.progress.get(bead.id) ?? { total: 0, completed: 0 };
  const children = tree.model.children.get(bead.id) ?? [];
  const contentId = React.useId();
  return (
    <section
      data-readable-epic={bead.id}
      className={`min-w-0 rounded-xl border border-border bg-[var(--surface-2)] ${tree.direction === "right" ? "w-max min-w-[320px]" : ""}`}
    >
      <div
        className="relative rounded-t-xl hover:bg-[var(--surface-3)]"
        data-connection-obstacle
        data-connection-node={bead.id}
        {...highlight}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={`${open ? "Collapse" : "Expand"} epic ${bead.title}`}
          onClick={() => tree.toggle(bead.id)}
          className="absolute inset-0 rounded-t-xl focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
        >
          <span aria-hidden="true" className="absolute right-4 top-4 text-xl text-[var(--text-3)]">
            {open ? "−" : "+"}
          </span>
        </button>
        <div className="pointer-events-none relative min-w-0 p-4 pr-12">
          <span className="block break-all font-mono text-xs text-[var(--text-3)]">
            Epic · {bead.id}
          </span>
          <button
            type="button"
            onClick={() => openDetail(bead.id)}
            aria-label={`Open epic ${bead.title}`}
            className="pointer-events-auto relative my-1 block min-h-11 break-words text-left text-sm font-semibold [overflow-wrap:anywhere] hover:underline"
          >
            {bead.title}
          </button>
          <span className="text-xs text-[var(--text-3)]">
            {progress.completed} / {progress.total} tasks complete
          </span>
          <div className="pointer-events-auto relative">
            <HighlightPathButton id={bead.id} title={bead.title} />
          </div>
        </div>
      </div>
      <div id={contentId} hidden={!open} className="border-t border-border p-6">
        {open && (
          <>
            {children.length ? (
              <ReadableItems items={children} {...tree} depth={tree.depth + 1} />
            ) : (
              <p data-connection-obstacle className="text-sm text-[var(--text-3)]">
                No child tasks match the current filter.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
