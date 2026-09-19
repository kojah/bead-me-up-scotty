import { expect, test } from "bun:test";
import { crossesBox, type GraphBox, routeAroundCards } from "../../lib/graph-routing";

function checkRoute(cards: GraphBox[], from: number, to: number) {
  const a = cards[from],
    b = cards[to];
  const source = { x: a.x + a.width, y: a.y + a.height / 2 };
  const target = { x: b.x, y: b.y + b.height / 2 };
  const points = routeAroundCards(source, target, cards);
  expect(points.length >= 2, "a visible route must exist").toBeTruthy();
  expect(points[0]).toStrictEqual(source);
  expect(points.at(-1)).toStrictEqual(target);
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1],
      point = points[i];
    expect(
      previous.x === point.x || previous.y === point.y,
      "segments are orthogonal",
    ).toBeTruthy();
    for (const card of cards)
      expect(crossesBox(previous, point, card), "route must not cross a card").toBe(false);
  }
}
const cards = [
  { x: 0, y: 0, width: 170, height: 120 },
  { x: 290, y: 0, width: 170, height: 120 },
  { x: 290, y: 144, width: 170, height: 240 },
  { x: 0, y: 144, width: 170, height: 120 },
  { x: 580, y: 0, width: 170, height: 120 },
];
test.each([
  [0, 4],
  [3, 4],
  [4, 0],
  [1, 2],
  [1, 1],
])("route %i → %i avoids cards", (from, to) => checkRoute(cards, from, to));
test("measured tall cards", () =>
  checkRoute(
    cards.map((c) => ({ ...c, height: c.height + 400, y: c.y * 4 })),
    3,
    4,
  ));
