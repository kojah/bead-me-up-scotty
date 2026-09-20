import { epicOwners, hideCompletedBeads } from "./graph-containers";
import { buildEpicGraphScope } from "./graph-epic";
import type { Bead } from "./schema";

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
