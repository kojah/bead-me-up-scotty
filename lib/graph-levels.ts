import { graphDependencyLayers } from "./graph-epic";
import { readableLinks } from "./readable-connections";
import type { Bead } from "./schema";

/** Project descendants to their sibling containers for placement only, never for arrows. */
export function siblingLevels(
  items: Bead[],
  all: Bead[],
  owners: ReadonlyMap<string, string>,
): Bead[][] {
  const ids = new Set(items.map((b) => b.id));
  const member = (id: string): string | undefined => {
    let current: string | undefined = id;
    while (current && !ids.has(current)) current = owners.get(current);
    return current;
  };
  const dependencies = new Map(items.map((b) => [b.id, new Set<string>()]));
  for (const link of readableLinks(all)) {
    const source = member(link.source),
      target = member(link.target);
    if (source && target && source !== target) dependencies.get(target)!.add(source);
  }
  const layers = graphDependencyLayers(
    items.map((b) => ({
      ...b,
      dependencies: [...dependencies.get(b.id)!].map((depends_on_id) => ({
        depends_on_id,
        type: "blocks",
      })),
    })),
  );
  const rows = new Map<number, Bead[]>();
  for (const bead of items) {
    const layer = layers.get(bead.id) ?? 0;
    rows.set(layer, [...(rows.get(layer) ?? []), bead]);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([, members]) => members);
}

/** Keep chains in the same lane and merges near the mean of their prerequisites. */
export function alignedLevels(items: Bead[], all: Bead[], owners: ReadonlyMap<string, string>) {
  const levels = siblingLevels(items, all, owners);
  const columns = Math.max(2, ...levels.map((row) => row.length * 2));
  const positions = new Map<string, number>();
  const links = readableLinks(all);
  const ids = new Set(items.map((b) => b.id));
  const representative = (id: string) => {
    let current: string | undefined = id;
    while (current && !ids.has(current)) current = owners.get(current);
    return current;
  };
  const parents = new Map<string, Set<string>>();
  for (const link of links) {
    const source = representative(link.source),
      target = representative(link.target);
    if (!source || !target || source === target) continue;
    const set = parents.get(target) ?? new Set<string>();
    set.add(source);
    parents.set(target, set);
  }
  const rows = levels.map((row) => {
    const desired = row
      .map((bead, index) => {
        const predecessors = [...(parents.get(bead.id) ?? [])].flatMap((id) =>
          positions.has(id) ? [positions.get(id)!] : [],
        );
        return {
          bead,
          column: predecessors.length
            ? Math.round(predecessors.reduce((a, b) => a + b, 0) / predecessors.length)
            : (columns - row.length * 2) / 2 + index * 2,
        };
      })
      .sort((a, b) => a.column - b.column || a.bead.id.localeCompare(b.bead.id));
    let previous = -2;
    return desired.map((entry, index) => {
      const column = Math.max(
        previous + 2,
        Math.min(entry.column, columns - (desired.length - index) * 2),
      );
      positions.set(entry.bead.id, column);
      previous = column;
      return { ...entry, column };
    });
  });
  return { columns, rows };
}
