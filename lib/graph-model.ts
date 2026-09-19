import { type Edge, MarkerType } from "@xyflow/react";
import { epicOwners, hideCompletedBeads } from "./graph-containers";
import { buildEpicGraphScope } from "./graph-epic";
import type { Bead, Dependency } from "./schema";

const FLOW_BLOCKING = new Set(["blocks", "conditional-blocks", "waits-for"]);

export function graphEdges(beads: Bead[]): Edge[] {
  const present = new Set(beads.map((bead) => bead.id));
  const edgeIds = new Set<string>();
  const edges: Edge[] = [];
  for (const bead of beads) {
    for (const dependency of bead.dependencies ?? []) {
      if (dependency.type === "parent-child") continue;
      if (!present.has(dependency.depends_on_id)) continue;
      const id = `${bead.id}->${dependency.depends_on_id}:${dependency.type}`;
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      edges.push(dependencyEdge(bead.id, dependency));
    }
  }
  return edges;
}

function liveGraphBeads(beads: Bead[], alwaysVisible = new Set<string>()): Bead[] {
  const active = beads.filter((bead) => bead.status !== "closed" || alwaysVisible.has(bead.id));
  const activeIds = new Set(active.map((bead) => bead.id));
  const linked = new Set<string>();
  for (const bead of active) {
    for (const dependency of bead.dependencies ?? []) {
      if (dependency.type === "parent-child" || !activeIds.has(dependency.depends_on_id)) continue;
      linked.add(bead.id);
      linked.add(dependency.depends_on_id);
    }
  }
  return active.filter(
    (bead) =>
      alwaysVisible.has(bead.id) ||
      bead.issue_type === "epic" ||
      linked.has(bead.id) ||
      (bead.dependencies ?? []).some(
        (dependency) =>
          dependency.type === "parent-child" && activeIds.has(dependency.depends_on_id),
      ),
  );
}

/** Apply scope, completion and linkage filters in one place, retaining epic ancestors. */
export function graphScope(
  beads: Bead[],
  epicId: string,
  hideCompleted: boolean,
  liveOnly: boolean,
) {
  const all = beads.filter((b) => !(b.labels ?? []).includes("archived"));
  const scope = epicId
    ? buildEpicGraphScope(all, epicId)
    : { beads: all, outsideIds: new Set<string>() };
  let visible = hideCompleted ? hideCompletedBeads(scope.beads) : scope.beads;
  if (liveOnly) {
    const owners = epicOwners(scope.beads);
    const keep = new Set(liveGraphBeads(visible).map((b) => b.id));
    for (const id of [...keep]) {
      let owner = owners.get(id);
      while (owner) {
        keep.add(owner);
        owner = owners.get(owner);
      }
    }
    visible = scope.beads.filter((b) => keep.has(b.id));
  }
  return { all, visible, outsideIds: scope.outsideIds, considered: scope.beads.length };
}

function dependencyEdge(beadId: string, dependency: Dependency): Edge {
  const id = `${beadId}->${dependency.depends_on_id}:${dependency.type}`;
  const blocking = FLOW_BLOCKING.has(dependency.type);
  const related = dependency.type === "related" || dependency.type === "relates-to";
  return {
    // IDs remain canonical dependent -> prerequisite in both modes so the
    // PR43 spotlight can compare them directly with graphNeighborhood.
    id,
    source: dependency.depends_on_id,
    target: beadId,
    animated: blocking,
    markerEnd: related
      ? undefined
      : { type: MarkerType.ArrowClosed, color: blocking ? "#ef4444" : "var(--text-3)" },
    style: {
      stroke: blocking ? "#ef4444" : related ? "var(--brand)" : "var(--text-3)",
      strokeWidth: blocking ? 2 : 1.6,
      strokeDasharray: related ? "5 4" : undefined,
    },
  };
}
