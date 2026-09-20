import { epicOwners } from "./graph-containers";
import { graphDependencyLayers } from "./graph-epic";
import type { Bead } from "./schema";

const BLOCKING = new Set(["blocks", "waits-for", "conditional-blocks"]);
export type TaskRelation = { id: string; bead?: Bead; types: string[] };

/** Immediate links, not transitive spotlight chains. Completed context remains useful. */
export function taskRelations(beads: Bead[], id: string) {
  const all = beads.filter((b) => !b.labels.includes("archived"));
  const byId = new Map(all.map((b) => [b.id, b]));
  const prerequisites = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const related = new Map<string, Set<string>>();
  function collect(from: string, to: string, type: string) {
    if (type === "parent-child" || from === to) return;
    if (from !== id && to !== id) return;
    const other = from === id ? to : from;
    const destination = BLOCKING.has(type) ? (from === id ? prerequisites : dependents) : related;
    const types = destination.get(other) ?? new Set<string>();
    types.add(type);
    destination.set(other, types);
  }
  for (const bead of all)
    for (const dep of bead.dependencies) collect(bead.id, dep.depends_on_id, dep.type);
  function entries(map: Map<string, Set<string>>): TaskRelation[] {
    return [...map]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([other, types]) => ({
        id: other,
        bead: byId.get(other),
        types: [...types].sort(),
      }));
  }
  return {
    bead: byId.get(id),
    prerequisites: entries(prerequisites),
    dependents: entries(dependents),
    related: entries(related),
  };
}

/** A cycle-safe ownership forest; every visible bead appears exactly once. */
export function readableGraph(visible: Bead[], all: Bead[], outsideIds: ReadonlySet<string>) {
  const owners = epicOwners(all);
  const inside = new Set(visible.filter((b) => !outsideIds.has(b.id)).map((b) => b.id));
  const children = new Map<string, Bead[]>();
  const layers = graphDependencyLayers(
    visible.map((b) => ({
      ...b,
      dependencies: b.dependencies.filter((d) => d.type !== "parent-child"),
    })),
  );
  const compare = (a: Bead, b: Bead) =>
    (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0) ||
    a.priority - b.priority ||
    a.id.localeCompare(b.id, undefined, { numeric: true });
  for (const bead of visible) {
    if (!inside.has(bead.id)) continue;
    const parent = owners.get(bead.id);
    const owner = parent && inside.has(parent) ? parent : "";
    const group = children.get(owner) ?? [];
    group.push(bead);
    children.set(owner, group);
  }
  for (const group of children.values()) group.sort(compare);
  const progress = new Map<string, { total: number; completed: number }>();
  for (const bead of all.filter((b) => b.issue_type !== "epic")) {
    let owner = owners.get(bead.id);
    while (owner) {
      const count = progress.get(owner) ?? { total: 0, completed: 0 };
      count.total++;
      count.completed += Number(bead.status === "closed");
      progress.set(owner, count);
      owner = owners.get(owner);
    }
  }
  return {
    visible,
    outsideIds,
    children,
    owners,
    progress,
    outside: visible.filter((b) => outsideIds.has(b.id)).sort(compare),
  };
}
