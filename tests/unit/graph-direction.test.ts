import { expect, test } from "bun:test";
import { containerLayout, epicOwners } from "../../lib/graph-containers";
import { siblingLevels } from "../../lib/graph-levels";
import { graphEdges } from "../../lib/graph-model";
import { crossesBox, type GraphBox, routeGraphEdges } from "../../lib/graph-routing";
import { topDownLayout } from "../../lib/graph-top-down";
import { readableLinks, routeReadableLinks } from "../../lib/readable-connections";
import { makeBead } from "../bead-fixture";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
const beads = [
  makeBead("first", { issue_type: "epic" }),
  makeBead("second", { issue_type: "epic" }),
  makeBead("a", { dependencies: [dep("first", "parent-child")] }),
  makeBead("b", { dependencies: [dep("second", "parent-child"), dep("a")] }),
  makeBead("c", { dependencies: [dep("second", "parent-child"), dep("b")] }),
];
test("descendant dependencies order sibling epics without inventing epic links", () => {
  expect(
    siblingLevels(beads.slice(0, 2).reverse(), beads, epicOwners(beads)).map((r) =>
      r.map((b) => b.id),
    ),
  ).toStrictEqual([["first"], ["second"]]);
  expect(readableLinks(beads).map((l) => [l.source, l.target])).toStrictEqual([
    ["a", "b"],
    ["b", "c"],
  ]);
});
test("cycles share a dependency level and disconnected peers keep deterministic order", () => {
  const cycle = [
    makeBead("a", { dependencies: [dep("b")] }),
    makeBead("b", { dependencies: [dep("a")] }),
    makeBead("c"),
  ];
  expect(siblingLevels(cycle, cycle, new Map()).map((r) => r.map((b) => b.id))).toStrictEqual([
    ["a", "b", "c"],
  ]);
});
test.each([1, 3])(
  "top-down canvas uses measured heights and contains descendants with %i columns",
  (columns) => {
    const nodes = topDownLayout(
      containerLayout(beads, beads, () => {}, new Set(), new Map([["b", 310]])),
      beads,
      columns,
    );
    const boxes = new Map(nodes.map((n) => [n.id, n.data.graphBox as GraphBox]));
    for (const node of nodes) {
      expect(node.data.horizontal).toBe(false);
      if (!node.parentId) continue;
      const box = boxes.get(node.id)!,
        parent = boxes.get(node.parentId)!;
      expect(box.x).toBeGreaterThan(parent.x);
      expect(box.y).toBeGreaterThan(parent.y + 90);
      expect(box.x + box.width).toBeLessThan(parent.x + parent.width);
      expect(box.y + box.height).toBeLessThan(parent.y + parent.height);
    }
    expect(boxes.get("b")!.height).toBe(310);
    expect(boxes.get("b")!.y).toBeGreaterThan(boxes.get("a")!.y + boxes.get("a")!.height);
    expect(boxes.get("c")!.y).toBeGreaterThan(boxes.get("b")!.y + 310);
    expect(
      routeGraphEdges(graphEdges(beads), nodes, "down").every((e) => Boolean(e.data?.path)),
    ).toBe(true);
  },
);
test("vertical ports route around tall intervening cards and title obstacles", () => {
  const boxes = new Map<string, GraphBox>([
    ["a", { x: 12, y: 12, width: 280, height: 150 }],
    ["middle", { x: 12, y: 194, width: 280, height: 310 }],
    ["b", { x: 12, y: 580, width: 280, height: 150 }],
  ]);
  const routes = routeReadableLinks(
    [{ source: "a", target: "b", types: ["blocks"] }],
    boxes,
    [],
    "down",
  );
  expect(routes).toHaveLength(1);
  const points = routes[0].points;
  expect(points[0]).toStrictEqual({ x: 152, y: 162 });
  expect(points.at(-1)).toStrictEqual({ x: 152, y: 580 });
  expect(points[1].y).toBeGreaterThan(points[0].y);
  expect(points.at(-2)!.y).toBeLessThan(points.at(-1)!.y);
  for (let i = 1; i < points.length; i++)
    for (const box of boxes.values()) expect(crossesBox(points[i - 1], points[i], box)).toBe(false);
});
