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
