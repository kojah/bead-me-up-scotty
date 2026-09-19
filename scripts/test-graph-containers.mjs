import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(name) {
  const exports = {};
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: (id) => (id.startsWith("./") ? load(id.slice(2)) : require(id)) },
  );
  return exports;
}
const { containerLayout, hideCompletedBeads, epicOwners } = load("graph-containers");
const dep = (id, type = "parent-child") => ({ depends_on_id: id, type });
const b = (id, extra = {}) => ({
  id,
  title: id,
  status: "open",
  issue_type: "task",
  priority: 2,
  dependencies: [],
  labels: [],
  ...extra,
});
const beads = [
  b("epic", { issue_type: "epic", status: "closed" }),
  b("nested", { issue_type: "epic", dependencies: [dep("epic")] }),
  b("first", { dependencies: [dep("nested")] }),
  b("second", { dependencies: [dep("epic"), dep("first", "blocks")] }),
  b("done", { status: "closed", dependencies: [dep("epic")] }),
  b("standalone"),
];
const visible = hideCompletedBeads(beads);
assert.ok(
  visible.some((b) => b.id === "epic"),
  "closed epic containing unfinished tasks stays",
);
assert.ok(!visible.some((b) => b.id === "done"));
const nodes = containerLayout(visible, beads, () => {});
const byId = new Map(nodes.map((n) => [n.id, n]));
assert.equal(byId.get("nested").parentId, "epic");
assert.equal(byId.get("first").parentId, "nested");
assert.equal(byId.get("standalone").parentId, undefined);
assert.equal(byId.get("epic").data.completed, 1);
assert.equal(byId.get("epic").data.total, 3);
function absolute(id) {
  const n = byId.get(id);
  const p = n.parentId ? absolute(n.parentId) : { x: 0, y: 0 };
  return { x: p.x + n.position.x, y: p.y + n.position.y };
}
assert.ok(absolute("first").x < absolute("second").x, "cross-epic prerequisite precedes dependent");
for (const n of nodes)
  if (n.parentId) {
    assert.ok(
      nodes.findIndex((p) => p.id === n.parentId) < nodes.indexOf(n),
      "parent emitted first",
    );
    const p = byId.get(n.parentId);
    assert.ok(n.position.x >= 0 && n.position.y >= 100);
    assert.ok(n.position.x + (n.style?.width ?? 170) <= p.style.width);
  }
const cyclic = [
  b("a", { issue_type: "epic", dependencies: [dep("b")] }),
  b("b", { issue_type: "epic", dependencies: [dep("a")] }),
];
assert.equal(epicOwners(cyclic).size, 1, "cyclic hierarchy safely broken");
assert.equal(containerLayout(cyclic, cyclic, () => {}).length, 2);
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
assert.equal(measured[1].position.y, 724, "layout uses measured height plus gap, not title length");
console.log("Container layout fixtures passed");
