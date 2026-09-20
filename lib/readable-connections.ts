import type { GraphDirection } from "./graph-direction";
import { type GraphBox, routeAroundCards } from "./graph-routing";
import type { Bead } from "./schema";

export type ReadableLink = { source: string; target: string; types: string[] };
const blocking = new Set(["blocks", "waits-for", "conditional-blocks"]);

/** Prerequisite → dependent. Membership and related links are not ordering arrows. */
export function readableLinks(beads: Bead[]): ReadableLink[] {
  const present = new Set(beads.filter((b) => !b.labels.includes("archived")).map((b) => b.id));
  const links = new Map<string, ReadableLink>();
  for (const bead of beads) {
    if (!present.has(bead.id)) continue;
    for (const dep of bead.dependencies) {
      if (
        !blocking.has(dep.type) ||
        dep.depends_on_id === bead.id ||
        !present.has(dep.depends_on_id)
      )
        continue;
      const key = JSON.stringify([dep.depends_on_id, bead.id]);
      const link = links.get(key) ?? { source: dep.depends_on_id, target: bead.id, types: [] };
      if (!link.types.includes(dep.type)) link.types.push(dep.type);
      links.set(key, link);
    }
  }
  return [...links.values()];
}

/** Never substitute an ancestor for a hidden endpoint: that changes the meaning. */
export function routeReadableLinks(
  links: ReadableLink[],
  boxes: ReadonlyMap<string, GraphBox>,
  additionalObstacles: GraphBox[] = [],
  direction: GraphDirection = "right",
  ports: ReadonlyMap<string, GraphBox> = boxes,
) {
  const obstacles = [...boxes.values(), ...additionalObstacles];
  return links.flatMap((link) => {
    const source = ports.get(link.source),
      target = ports.get(link.target);
    if (!source || !target) return [];
    const points = routeAroundCards(
      direction === "down"
        ? { x: source.x + source.width / 2, y: source.y + source.height }
        : { x: source.x + source.width, y: source.y + source.height / 2 },
      direction === "down"
        ? { x: target.x + target.width / 2, y: target.y }
        : { x: target.x, y: target.y + target.height / 2 },
      obstacles,
      direction,
    );
    if (!points.length) return [];
    return [
      { ...link, points, path: points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") },
    ];
  });
}
