import { expect, test } from "bun:test";
import { filterDepCandidates } from "../../lib/dep-picker";

const beads = [
  { id: "work-10", title: "Deploy worker", status: "closed" },
  { id: "self", title: "Deploy current" },
  { id: "work-2", title: "Deploy API" },
  { id: "linked", title: "Deploy existing dependency" },
  { id: "parent", title: "Deploy parent" },
  { id: "a-reference", title: "Follow up on work-2" },
];
test.each([
  ["", ["a-reference", "work-2", "work-10"]],
  ["  DEPLOY  ", ["work-2", "work-10"]],
  ["WORK-2", ["work-2", "a-reference"]],
  ["absent", []],
  ["self", []],
] as const)("dependency query %s", (query, expected) => {
  const before = structuredClone(beads);
  expect(
    filterDepCandidates(beads, query, { currentId: "self", linkedIds: ["linked", "parent"] }).map(
      (b) => b.id,
    ),
  ).toStrictEqual([...expected]);
  expect(beads).toStrictEqual(before);
});
test("does not truncate eligible results", () => {
  const many = Array.from({ length: 205 }, (_, i) => ({
    id: `bead-${i}`,
    title: "Available task",
  }));
  expect(filterDepCandidates(many, "", { currentId: "none", linkedIds: [] })).toHaveLength(205);
});
