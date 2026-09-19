import type { Edge, Node } from "@xyflow/react";

export type Point = { x: number; y: number };
export type GraphBox = Point & { width: number; height: number };
const CLEARANCE = 10;

/** Strict intersection permits travel on the clearance boundary, never through a card. */
export function crossesBox(a: Point, b: Point, box: GraphBox): boolean {
  if (a.x === b.x) {
    return (
      a.x > box.x &&
      a.x < box.x + box.width &&
      Math.max(a.y, b.y) > box.y &&
      Math.min(a.y, b.y) < box.y + box.height
    );
  }
  return (
    a.y > box.y &&
    a.y < box.y + box.height &&
    Math.max(a.x, b.x) > box.x &&
    Math.min(a.x, b.x) < box.x + box.width
  );
}

function padded(box: GraphBox): GraphBox {
  return {
    x: box.x - CLEARANCE,
    y: box.y - CLEARANCE,
    width: box.width + CLEARANCE * 2,
    height: box.height + CLEARANCE * 2,
  };
}

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const a = result.at(-2),
      b = result.at(-1);
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)))
      result.pop();
    result.push(point);
  }
  return result;
}

type SearchEntry = { id: number; distance: number; estimate: number };

/** A* on rectilinear clearance channels. Only visited segments are tested. */
function searchChannels(start: Point, end: Point, obstacles: GraphBox[]): Point[] {
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap((b) => [b.x, b.x + b.width])])].sort(
    (a, b) => a - b,
  );
  const ys = [
    ...new Set([start.y, end.y, ...obstacles.flatMap((b) => [b.y, b.y + b.height])]),
  ].sort((a, b) => a - b);
  const idOf = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  const pointOf = (id: number): Point => ({
    x: xs[id % xs.length],
    y: ys[Math.floor(id / xs.length)],
  });
  const first = idOf(start),
    last = idOf(end);
  const distances = new Map([[first, 0]]);
  const previous = new Map<number, number>();
  const pending: SearchEntry[] = [{ id: first, distance: 0, estimate: 0 }];

  function neighbors(id: number): number[] {
    const col = id % xs.length,
      row = Math.floor(id / xs.length);
    return [
      [col - 1, row],
      [col + 1, row],
      [col, row - 1],
      [col, row + 1],
    ]
      .filter(([x, y]) => x >= 0 && x < xs.length && y >= 0 && y < ys.length)
      .map(([x, y]) => y * xs.length + x);
  }
  function visit(current: SearchEntry) {
    const a = pointOf(current.id);
    for (const id of neighbors(current.id)) {
      const b = pointOf(id);
      const distance = current.distance + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (distance >= (distances.get(id) ?? Infinity)) continue;
      if (obstacles.some((box) => crossesBox(a, b, box))) continue;
      distances.set(id, distance);
      previous.set(id, current.id);
      pending.push({
        id,
        distance,
        estimate: distance + Math.abs(b.x - end.x) + Math.abs(b.y - end.y),
      });
    }
  }
  while (pending.length) {
    pending.sort((a, b) => b.estimate - a.estimate || b.distance - a.distance);
    const current = pending.pop()!;
    if (current.id === last) return reconstruct(last, previous, pointOf);
    if (current.distance !== distances.get(current.id)) continue;
    visit(current);
  }
  return [];
}

function reconstruct(
  last: number,
  previous: Map<number, number>,
  pointOf: (id: number) => Point,
): Point[] {
  const points: Point[] = [];
  let cursor: number | undefined = last;
  while (cursor !== undefined) {
    points.push(pointOf(cursor));
    cursor = previous.get(cursor);
  }
  return points.reverse();
}

export function routeAroundCards(source: Point, target: Point, cards: GraphBox[]): Point[] {
  const start = { x: source.x + CLEARANCE, y: source.y };
  const end = { x: target.x - CLEARANCE, y: target.y };
  const obstacles = cards.map(padded);
  const middleX = (start.x + end.x) / 2;
  const direct = [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
  const clear = direct
    .slice(1)
    .every((p, i) => !obstacles.some((box) => crossesBox(direct[i], p, box)));
  const points = clear ? direct : searchChannels(start, end, obstacles);
  return points.length ? simplify([source, ...points, target]) : [];
}

function nodeBox(node: Node): GraphBox {
  return node.data.graphBox as GraphBox;
}

export function routeGraphEdges(edges: Edge[], nodes: Node[]): Edge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Epic interiors are traversable, but their title bars are obstacles too.
  const obstacles = nodes.map((node) => ({
    ...nodeBox(node),
    height: node.type === "epic" ? 90 : nodeBox(node).height,
  }));
  return edges.map((edge) => {
    const source = byId.get(edge.source),
      target = byId.get(edge.target);
    if (!source || !target) return edge;
    const a = nodeBox(source),
      b = nodeBox(target);
    const points = routeAroundCards(
      { x: a.x + a.width, y: a.y + (source.type === "epic" ? 45 : a.height / 2) },
      { x: b.x, y: b.y + (target.type === "epic" ? 45 : b.height / 2) },
      obstacles,
    );
    const path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    return { ...edge, type: "routed", data: { ...edge.data, path } };
  });
}
