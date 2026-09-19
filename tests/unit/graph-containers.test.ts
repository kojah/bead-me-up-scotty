import { expect, test } from "bun:test";
import { containerLayout, epicOwners, hideCompletedBeads } from "../../lib/graph-containers";
import { makeBead, required } from "../bead-fixture";

test("epic containment, cycles, completion and measured sizes", () => {
  const dep = (id: string, type = "parent-child") => ({ depends_on_id: id, type });
  const b = makeBead;
  const beads = [
    b("epic", { issue_type: "epic", status: "closed" }),
    b("nested", { issue_type: "epic", dependencies: [dep("epic")] }),
    b("first", { dependencies: [dep("nested")] }),
    b("second", { dependencies: [dep("epic"), dep("first", "blocks")] }),
    b("done", { status: "closed", dependencies: [dep("epic")] }),
    b("standalone"),
  ];
  const visible = hideCompletedBeads(beads);
  expect(
    visible.some((b) => b.id === "epic"),
    "closed epic containing unfinished tasks stays",
  ).toBeTruthy();
  expect(!visible.some((b) => b.id === "done")).toBeTruthy();
  const nodes = containerLayout(visible, beads, () => {});
  const byId = new Map(nodes.map((n) => [n.id, n]));
  expect(required(byId.get("nested")).parentId).toBe("epic");
  expect(required(byId.get("first")).parentId).toBe("nested");
  expect(required(byId.get("standalone")).parentId).toBe(undefined);
  expect(required(byId.get("epic")).data.completed).toBe(1);
  expect(required(byId.get("epic")).data.total).toBe(3);
  function absolute(id: string): { x: number; y: number } {
    const n = required(byId.get(id));
    const p = n.parentId ? absolute(n.parentId) : { x: 0, y: 0 };
    return { x: p.x + n.position.x, y: p.y + n.position.y };
  }
  expect(
    absolute("first").x < absolute("second").x,
    "cross-epic prerequisite precedes dependent",
  ).toBeTruthy();
  for (const n of nodes)
    if (n.parentId) {
      expect(
        nodes.findIndex((p) => p.id === n.parentId) < nodes.indexOf(n),
        "parent emitted first",
      ).toBeTruthy();
      const p = required(byId.get(n.parentId));
      expect(n.position.x >= 0 && n.position.y >= 100).toBeTruthy();
      expect(n.position.x + Number(n.style?.width ?? 170) <= Number(p.style?.width)).toBeTruthy();
    }
  const cyclic = [
    b("a", { issue_type: "epic", dependencies: [dep("b")] }),
    b("b", { issue_type: "epic", dependencies: [dep("a")] }),
  ];
  expect(epicOwners(cyclic).size, "cyclic hierarchy safely broken").toBe(1);
  expect(containerLayout(cyclic, cyclic, () => {}).length).toBe(2);
  const measured = containerLayout(
    [b("one"), b("two")],
    [],
    () => {},
    new Set(),
    new Map([
      ["one", 700],
      ["two", 80],
    ]),
  );
  expect(measured[1].position.y, "layout uses measured height plus gap, not title length").toBe(
    724,
  );
  console.log("Container layout fixtures passed");
});
