import type { GraphDirection } from "./graph-direction";
import { roundedPath } from "./graph-rounded-path";
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
  const shown = links.filter((link) => ports.has(link.source) && ports.has(link.target));
  const lanes: GraphBox[] = [];
  return shown.flatMap((link, index) => {
    const source = ports.get(link.source),
      target = ports.get(link.target);
    if (!source || !target) return [];
    const offset = (id: string, end: "source" | "target") => {
      const group = shown
        .filter((l) => l[end] === id)
        .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
      const box = ports.get(id)!;
      const span = direction === "down" ? box.width : box.height;
      return (
        (group.indexOf(link) - (group.length - 1) / 2) *
        Math.min(12, Math.max(0, span - 32) / group.length)
      );
    };
    const start =
      direction === "down"
        ? {
            x: source.x + source.width / 2 + offset(link.source, "source"),
            y: source.y + source.height,
          }
        : {
            x: source.x + source.width,
            y: source.y + source.height / 2 + offset(link.source, "source"),
          };
    const end =
      direction === "down"
        ? { x: target.x + target.width / 2 + offset(link.target, "target"), y: target.y }
        : { x: target.x, y: target.y + target.height / 2 + offset(link.target, "target") };
    let points = routeAroundCards(
      start,
      end,
      [...obstacles, ...lanes],
      direction,
      10 + (index % 4) * 2,
    );
    if (!points.length) points = routeAroundCards(start, end, obstacles, direction);
    if (!points.length) return [];
    lanes.push(...reservedLanes(points));
    return [{ ...link, points, path: roundedPath(points) }];
  });
}

function reservedLanes(points: { x: number; y: number }[]): GraphBox[] {
  return points.slice(2, -1).flatMap((b, index) => {
    const a = points[index + 1];
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length < 48) return [];
    return a.x === b.x
      ? [{ x: a.x - 1, y: Math.min(a.y, b.y) + 16, width: 2, height: length - 32 }]
      : [{ x: Math.min(a.x, b.x) + 16, y: a.y - 1, width: length - 32, height: 2 }];
  });
}
