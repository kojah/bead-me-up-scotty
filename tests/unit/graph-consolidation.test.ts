import { expect, test } from "bun:test";
import { epicOwners, hideCompletedBeads } from "../../lib/graph-containers";
import { graphScope } from "../../lib/graph-model";
import { isBlockingLink, readableLinks } from "../../lib/readable-connections";
import { makeBead } from "../bead-fixture";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
test("other relationships are opt-in and never hierarchy or execution order", () => {
  const beads = [
    makeBead("a"),
    makeBead("b", {
      dependencies: [dep("a", "related"), dep("a", "tracks"), dep("a", "parent-child")],
    }),
  ];
  expect(readableLinks(beads)).toEqual([]);
  const links = readableLinks(beads, true);
  expect(links).toEqual([{ source: "a", target: "b", types: ["related", "tracks"] }]);
  expect(isBlockingLink(links[0])).toBe(false);
});
test("closed owners stay around unfinished nested work; live filtering drops loose tasks", () => {
  const beads = [
    makeBead("epic", { issue_type: "epic", status: "closed" }),
    makeBead("nested", { issue_type: "epic", dependencies: [dep("epic", "parent-child")] }),
    makeBead("work", { dependencies: [dep("nested", "parent-child")] }),
    makeBead("done", { status: "closed" }),
    makeBead("loose"),
  ];
  expect(epicOwners(beads).get("work")).toBe("nested");
  expect(hideCompletedBeads(beads).map((b) => b.id)).toEqual(["epic", "nested", "work", "loose"]);
  expect(graphScope(beads, "", true, true).visible.map((b) => b.id)).toEqual([
    "epic",
    "nested",
    "work",
  ]);
});
