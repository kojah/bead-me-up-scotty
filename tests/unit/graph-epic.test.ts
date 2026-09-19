import { expect, test } from "bun:test";
import { buildEpicGraphScope, graphDependencyLayers } from "../../lib/graph-epic";
import { makeBead, required } from "../bead-fixture";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
test("deep dependency chains avoid call-stack limits", () => {
  const deep = Array.from({ length: 2500 }, (_, i) =>
    makeBead(`chain-${i}`, { dependencies: i ? [dep(`chain-${i - 1}`)] : [] }),
  );
  expect(graphDependencyLayers(deep).get("chain-2499")).toBe(2499);
});
test("cycles share layers, downstream work advances and input order is irrelevant", () => {
  const beads = [
    makeBead("a", { dependencies: [dep("b")] }),
    makeBead("b", { dependencies: [dep("a")] }),
    makeBead("c", { dependencies: [dep("a")] }),
  ];
  const layers = graphDependencyLayers(beads);
  expect(layers.get("a")).toBe(layers.get("b"));
  expect(required(layers.get("c"))).toBeGreaterThan(required(layers.get("a")));
  expect([...graphDependencyLayers([...beads].reverse())]).toStrictEqual([...layers]);
});
test("epic scope retains recursive descendants and one-hop external context", () => {
  const beads = [
    makeBead("epic", { issue_type: "epic" }),
    makeBead("child", { dependencies: [dep("epic", "parent-child")] }),
    makeBead("grandchild", { dependencies: [dep("child", "parent-child"), dep("outside")] }),
    makeBead("outside"),
    makeBead("unrelated"),
  ];
  const scope = buildEpicGraphScope(beads, "epic");
  expect([...scope.insideIds]).toStrictEqual(["epic", "child", "grandchild"]);
  expect([...scope.outsideIds]).toStrictEqual(["outside"]);
  expect(scope.beads.map((b) => b.id)).toStrictEqual(["epic", "child", "grandchild", "outside"]);
});
