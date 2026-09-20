import { expect, test } from "bun:test";
import { alignedLevels } from "../../lib/graph-levels";
import { roundedPath } from "../../lib/graph-rounded-path";
import { makeBead } from "../bead-fixture";

const dep = (depends_on_id: string) => ({ depends_on_id, type: "blocks" });
test("alignment keeps a chain straight and centers a merge between its prerequisites", () => {
  const beads = [
    makeBead("a"),
    makeBead("b"),
    makeBead("merge", { dependencies: [dep("a"), dep("b")] }),
    makeBead("next", { dependencies: [dep("merge")] }),
  ];
  const { rows } = alignedLevels(beads, beads, new Map());
  expect(rows[1][0].column).toBe((rows[0][0].column + rows[0][1].column) / 2);
  expect(rows[2][0].column).toBe(rows[1][0].column);
});
test("rounding preserves endpoints and clips radius to short segments", () => {
  const path = roundedPath([
    { x: 0, y: 0 },
    { x: 0, y: 20 },
    { x: 4, y: 20 },
    { x: 4, y: 40 },
  ]);
  expect(path).toStartWith("M 0 0");
  expect(path).toEndWith("L 4 40");
  expect(path).toContain("Q 0 20 2 20");
  expect(roundedPath([])).toBe("");
});
