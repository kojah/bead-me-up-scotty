import { expect, test } from "bun:test";
import { graphScope } from "../../lib/graph-model";
import { readableGraph, taskRelations } from "../../lib/readable-graph";
import { makeBead } from "../bead-fixture";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });

test("task focus retains completed prerequisites, not transitive chains or hierarchy", () => {
  const beads = [
    makeBead("epic", { issue_type: "epic" }),
    makeBead("far"),
    makeBead("up", { status: "closed", dependencies: [dep("far")] }),
    makeBead("work", { dependencies: [dep("up"), dep("epic", "parent-child")] }),
    makeBead("down", { dependencies: [dep("work", "waits-for")] }),
    makeBead("far-down", { dependencies: [dep("down")] }),
  ];
  const focus = taskRelations(beads, "work");
  expect(focus.prerequisites.map((b) => b.id)).toStrictEqual(["up"]);
  expect(focus.prerequisites[0].bead?.status).toBe("closed");
  expect(focus.dependents.map((b) => b.id)).toStrictEqual(["down"]);
  expect(focus.related).toStrictEqual([]);
});

test("relation types are deduplicated; non-blocking links stay separate", () => {
  const beads = [
    makeBead("work", {
      dependencies: [
        dep("up"),
        dep("up"),
        dep("up", "conditional-blocks"),
        dep("other", "related"),
        dep("missing", "tracks"),
      ],
    }),
    makeBead("up"),
    makeBead("other", { dependencies: [dep("work", "related")] }),
  ];
  const focus = taskRelations(beads, "work");
  expect(focus.prerequisites).toHaveLength(1);
  expect(focus.prerequisites[0].types).toStrictEqual(["blocks", "conditional-blocks"]);
  expect(focus.related.map((b) => b.id)).toStrictEqual(["missing", "other"]);
  expect(focus.related[1].types).toStrictEqual(["related"]);
});

test("missing and archived prerequisites remain explicitly unavailable", () => {
  const focus = taskRelations(
    [
      makeBead("work", { dependencies: [dep("missing"), dep("archived")] }),
      makeBead("archived", { labels: ["archived"] }),
    ],
    "work",
  );
  expect(focus.prerequisites.map((b) => [b.id, b.bead])).toStrictEqual([
    ["archived", undefined],
    ["missing", undefined],
  ]);
  expect(taskRelations([makeBead("work", { labels: ["archived"] })], "work").bead).toBeUndefined();
});

test("blocking cycles do not recurse or include self links", () => {
  const focus = taskRelations(
    [
      makeBead("a", { dependencies: [dep("a"), dep("b")] }),
      makeBead("b", { dependencies: [dep("a")] }),
    ],
    "a",
  );
  expect(focus.prerequisites.map((b) => b.id)).toStrictEqual(["b"]);
  expect(focus.dependents.map((b) => b.id)).toStrictEqual(["b"]);
});

const family = [
  makeBead("root", { issue_type: "epic", status: "closed" }),
  makeBead("nested", { issue_type: "epic", dependencies: [dep("root", "parent-child")] }),
  makeBead("done", { status: "closed", dependencies: [dep("nested", "parent-child")] }),
  makeBead("work", { dependencies: [dep("nested", "parent-child"), dep("outside")] }),
  makeBead("outside"),
  makeBead("unrelated"),
];
test("forest preserves nested ownership and totals despite completion filtering", () => {
  const scope = graphScope(family, "", true, false);
  const model = readableGraph(scope.visible, scope.all, scope.outsideIds);
  expect(model.children.get("root")?.map((b) => b.id)).toStrictEqual(["nested"]);
  expect(model.children.get("nested")?.map((b) => b.id)).toStrictEqual(["work"]);
  expect(model.progress.get("root")).toStrictEqual({ total: 2, completed: 1 });
  expect(model.progress.get("nested")).toStrictEqual({ total: 2, completed: 1 });
});
test("epic scoping keeps external context separate and excludes unrelated work", () => {
  const scope = graphScope(family, "root", true, false);
  const model = readableGraph(scope.visible, scope.all, scope.outsideIds);
  expect(model.children.get("")?.map((b) => b.id)).toStrictEqual(["root"]);
  expect(model.outside.map((b) => b.id)).toStrictEqual(["outside"]);
  expect(
    [...model.children.values()]
      .flat()
      .map((b) => b.id)
      .sort(),
  ).toStrictEqual(["nested", "root", "work"]);
});
test("cyclic and multi-parent hierarchy produces a deterministic forest", () => {
  const beads = [
    makeBead("a", { issue_type: "epic", dependencies: [dep("b", "parent-child")] }),
    makeBead("b", { issue_type: "epic", dependencies: [dep("a", "parent-child")] }),
    makeBead("task", { dependencies: [dep("a", "parent-child"), dep("b", "parent-child")] }),
  ];
  const model = readableGraph(beads, beads, new Set());
  const flat = [...model.children.values()].flat();
  expect(flat.map((b) => b.id).sort()).toStrictEqual(["a", "b", "task"]);
  expect(new Set(flat.map((b) => b.id)).size).toBe(3);
  expect([...readableGraph([...beads].reverse(), beads, new Set()).owners]).toStrictEqual([
    ...model.owners,
  ]);
  expect(model.children.get("")).toHaveLength(1);
});
test("task ordering follows prerequisites, not priority or hierarchy links", () => {
  const beads = [
    makeBead("later", { priority: 0, dependencies: [dep("first")] }),
    makeBead("first", { priority: 4 }),
  ];
  expect(
    readableGraph(beads, beads, new Set())
      .children.get("")
      ?.map((b) => b.id),
  ).toStrictEqual(["first", "later"]);
});
