import { expect, test } from "bun:test";
import { crossesBox, type GraphBox } from "../../lib/graph-routing";
import { readableLinks, routeReadableLinks } from "../../lib/readable-connections";
import { makeBead } from "../bead-fixture";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
test("arrows preserve epic versus child endpoints and exclude membership, related and unavailable links", () => {
  const beads = [
    makeBead("epic", {
      issue_type: "epic",
      dependencies: [dep("up"), dep("up"), dep("up", "waits-for")],
    }),
    makeBead("child", {
      dependencies: [
        dep("epic", "parent-child"),
        dep("up"),
        dep("child"),
        dep("missing"),
        dep("archived"),
        dep("other", "related"),
      ],
    }),
    makeBead("up"),
    makeBead("other"),
    makeBead("archived", { labels: ["archived"] }),
  ];
  expect(readableLinks(beads)).toStrictEqual([
    { source: "up", target: "epic", types: ["blocks", "waits-for"] },
    { source: "up", target: "child", types: ["blocks"] },
  ]);
});

test.each([false, true])(
  "measured %s mobile routes avoid all titles/cards; hidden children are never mapped to epic borders",
  (mobile) => {
    const boxes = new Map<string, GraphBox>([
      ["up", { x: 12, y: 12, width: 260, height: 100 }],
      ["epic", { x: mobile ? 12 : 320, y: mobile ? 160 : 12, width: 260, height: 120 }],
      ["child", { x: mobile ? 36 : 344, y: mobile ? 310 : 162, width: 212, height: 150 }],
    ]);
    const links = [
      { source: "up", target: "epic", types: ["blocks"] },
      { source: "up", target: "child", types: ["blocks"] },
      { source: "child", target: "up", types: ["blocks"] },
    ];
    const routes = routeReadableLinks(links, boxes);
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      const target = boxes.get(route.target)!;
      expect(route.points.at(-1)).toStrictEqual({ x: target.x, y: target.y + target.height / 2 });
      for (let i = 1; i < route.points.length; i++)
        for (const box of boxes.values())
          expect(crossesBox(route.points[i - 1], route.points[i], box)).toBe(false);
    }
    boxes.delete("child");
    expect(routeReadableLinks(links, boxes).map((r) => r.target)).toStrictEqual(["epic"]);
  },
);
