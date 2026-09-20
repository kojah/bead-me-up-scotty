import type { Point } from "./graph-routing";

/** Radius stays inside the router's ten-pixel obstacle clearance. */
export function roundedPath(points: Point[], radius = 6): string {
  if (!points.length) return "";
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const before = Math.hypot(b.x - a.x, b.y - a.y),
      after = Math.hypot(c.x - b.x, c.y - b.y);
    if (!before || !after) continue;
    const r = Math.min(radius, before / 2, after / 2);
    const start = { x: b.x + ((a.x - b.x) * r) / before, y: b.y + ((a.y - b.y) * r) / before };
    const end = { x: b.x + ((c.x - b.x) * r) / after, y: b.y + ((c.y - b.y) * r) / after };
    commands.push(`L ${start.x} ${start.y} Q ${b.x} ${b.y} ${end.x} ${end.y}`);
  }
  const end = points.at(-1)!;
  commands.push(`L ${end.x} ${end.y}`);
  return commands.join(" ");
}
