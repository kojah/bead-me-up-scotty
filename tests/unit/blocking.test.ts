import { expect, test } from "bun:test";
import { blockingDeps, isBlocked, makeIndex, readyHumanGate } from "../../lib/beads-view";
import { makeBead } from "../bead-fixture";

const types = [
  "blocks",
  "waits-for",
  "conditional-blocks",
  "parent-child",
  "related",
  "supersedes",
];
for (const type of types) {
  test.each(["open", "closed", "missing"])(`${type} dependency on %s`, (status) => {
    const bead = makeBead("work", { dependencies: [{ type, depends_on_id: "upstream" }] });
    const index = makeIndex(
      status === "missing" ? [bead] : [bead, makeBead("upstream", { status })],
    );
    const blocked =
      ["blocks", "waits-for", "conditional-blocks"].includes(type) && status !== "closed";
    expect(isBlocked(bead, index)).toBe(blocked);
    expect(blockingDeps(bead, index)).toStrictEqual(blocked ? ["upstream"] : []);
    expect(readyHumanGate({ ...bead, issue_type: "gate", await_type: "human" }, index)).toBe(
      !blocked,
    );
  });
}
test("explicit blocked status", () =>
  expect(isBlocked(makeBead("manual", { status: "blocked" }), new Map())).toBe(true));
test.each(["closed", "deferred", "in_progress", "hooked", "pinned"])(
  "%s ignores missing prerequisite",
  (status) => {
    expect(
      isBlocked(
        makeBead("inactive", {
          status,
          dependencies: [{ type: "blocks", depends_on_id: "missing" }],
        }),
        new Map(),
      ),
    ).toBe(false);
  },
);
