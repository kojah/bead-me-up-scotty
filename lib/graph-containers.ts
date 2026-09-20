import type { Bead } from "./schema";

// A tree needs one owner. Resolve malformed multi-parent/cyclic input
// deterministically, including tasks parented through another ordinary task.
export function epicOwners(beads: Bead[]): Map<string, string> {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const owners = new Map<string, string>();
  function assignOwner(bead: Bead) {
    const seen = new Set([bead.id]);
    const pending = [bead.id];
    while (pending.length) {
      const current = byId.get(pending.shift()!)!;
      const parents = parentIds(current);
      function chooseParent(id: string): boolean {
        if (seen.has(id) || !byId.has(id)) return false;
        seen.add(id);
        if (byId.get(id)!.issue_type !== "epic") {
          pending.push(id);
          return false;
        }
        if (wouldCycle(bead.id, id, owners)) return false;
        owners.set(bead.id, id);
        pending.length = 0;
        return true;
      }
      parents.some(chooseParent);
    }
  }
  [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).forEach(assignOwner);
  return owners;
}

export function hideCompletedBeads(beads: Bead[]): Bead[] {
  const owners = epicOwners(beads);
  const keep = new Set(beads.filter((b) => b.status !== "closed").map((b) => b.id));
  for (const id of [...keep]) {
    let parent = owners.get(id);
    while (parent && !keep.has(parent)) {
      keep.add(parent);
      parent = owners.get(parent);
    }
  }
  return beads.filter((b) => keep.has(b.id));
}

function wouldCycle(beadId: string, owner: string, owners: Map<string, string>): boolean {
  let ancestor: string | undefined = owner;
  const path = new Set([beadId]);
  while (ancestor && !path.has(ancestor)) {
    path.add(ancestor);
    ancestor = owners.get(ancestor);
  }
  return Boolean(ancestor);
}

function parentIds(current: Bead): string[] {
  const parents = (current.dependencies ?? [])
    .filter((d) => d.type === "parent-child")
    .map((d) => d.depends_on_id)
    .sort();

  return parents;
}
