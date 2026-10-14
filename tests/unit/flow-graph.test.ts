import { expect, test } from "bun:test";
import { buildFlowGraph } from "../../lib/flow-graph";
import { makeBead } from "../bead-fixture";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
const build = (beads: ReturnType<typeof makeBead>[], collapsed = new Set<string>()) =>
  buildFlowGraph(beads, beads, new Set(), collapsed, "right");

test("nested epic groups contain compact nodes and precede their children", () => {
  const beads = [
    makeBead("outer", { issue_type: "epic" }),
    makeBead("inner", { issue_type: "epic", dependencies: [dep("outer", "parent-child")] }),
    makeBead("task", { dependencies: [dep("inner", "parent-child")] }),
  ];
  const { nodes, edges } = build(beads);
  expect(nodes.map((node) => node.id)).toEqual(["outer", "inner", "task"]);
  expect(edges).toHaveLength(0);
  for (const node of nodes.filter((node) => node.parentId)) {
    const parent = nodes.find((item) => item.id === node.parentId)!;
    expect(node.position.x).toBeGreaterThanOrEqual(0);
    expect(node.position.y).toBeGreaterThanOrEqual(40);
    expect(node.position.x + Number(node.style!.width)).toBeLessThanOrEqual(
      Number(parent.style!.width),
    );
    expect(node.position.y + Number(node.style!.height)).toBeLessThanOrEqual(
      Number(parent.style!.height),
    );
  }
  expect(nodes[2].style!.height).toBe(72);
});

test("cross-epic dependency arrows retain prerequisite to dependent direction", () => {
  const beads = [
    makeBead("left", { issue_type: "epic" }),
    makeBead("right", { issue_type: "epic" }),
    makeBead("a", { dependencies: [dep("left", "parent-child")] }),
    makeBead("b", { dependencies: [dep("right", "parent-child"), dep("a")] }),
  ];
  for (const direction of ["right", "down"] as const) {
    const { edges } = buildFlowGraph(beads, beads, new Set(), new Set(), direction);
    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([["a", "b"]]);
    expect(edges[0].data?.path).toMatch(/^M /);
  }
});

test("collapse combines external dependencies without inventing membership or self arrows", () => {
  const beads = [
    makeBead("epic", { issue_type: "epic" }),
    makeBead("a", { dependencies: [dep("epic", "parent-child")] }),
    makeBead("b", { dependencies: [dep("epic", "parent-child"), dep("a")] }),
    makeBead("outside", { dependencies: [dep("a"), dep("b")] }),
  ];
  const { nodes, edges } = build(beads, new Set(["epic"]));
  expect(nodes.map((node) => node.id)).toEqual(["epic", "outside"]);
  expect(edges.map((edge) => [edge.source, edge.target])).toEqual([["epic", "outside"]]);
  expect(nodes[0].data.collapsed).toBe(true);
});

test("malformed hierarchy and dependency cycles stay finite and deterministic", () => {
  const beads = [
    makeBead("a", { issue_type: "epic", dependencies: [dep("b", "parent-child"), dep("b")] }),
    makeBead("b", { issue_type: "epic", dependencies: [dep("a", "parent-child"), dep("a")] }),
  ];
  const result = build(beads);
  expect(result.nodes).toHaveLength(2);
  expect(new Set(result.nodes.map((node) => node.id)).size).toBe(2);
  expect(build([...beads].reverse()).nodes).toEqual(result.nodes);
});
