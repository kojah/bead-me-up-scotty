import assert from "node:assert/strict";
import { crossesBox, type GraphBox, routeAroundCards } from "../lib/graph-routing";

function checkRoute(cards: GraphBox[], from: number, to: number) {
  const a = cards[from],
    b = cards[to];
  const source = { x: a.x + a.width, y: a.y + a.height / 2 };
  const target = { x: b.x, y: b.y + b.height / 2 };
  const points = routeAroundCards(source, target, cards);
  assert.ok(points.length >= 2, "a visible route must exist");
  assert.deepEqual(points[0], source);
  assert.deepEqual(points.at(-1), target);
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1],
      point = points[i];
    assert.ok(previous.x === point.x || previous.y === point.y, "segments are orthogonal");
    for (const card of cards)
      assert.equal(crossesBox(previous, point, card), false, "route must not cross a card");
  }
}
const cards = [
  { x: 0, y: 0, width: 170, height: 120 },
  { x: 290, y: 0, width: 170, height: 120 },
  { x: 290, y: 144, width: 170, height: 240 },
  { x: 0, y: 144, width: 170, height: 120 },
  { x: 580, y: 0, width: 170, height: 120 },
];
checkRoute(cards, 0, 4); // Skips a layer occupied by another card.
checkRoute(cards, 3, 4); // Screenshot case: fan-in passes an intermediate card.
checkRoute(cards, 4, 0); // Backward link/cycle.
checkRoute(cards, 1, 2); // Same column.
checkRoute(cards, 1, 1); // Self-loop.
checkRoute(
  cards.map((c) => ({ ...c, height: c.height + 400, y: c.y * 4 })),
  3,
  4,
);
console.log(
  "PASS: graph routes avoid cards for skipped layers, fan-in, cycles, self-loops and measured tall cards",
);
