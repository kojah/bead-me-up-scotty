import { type Bead, beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("graph", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: id,
      issue_type: "task",
      status: "open",
      priority: 2,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      labels: [],
      dependencies: [],
      ...extra,
    });
  const dep = (id: string, target: string, type = "blocks") => ({
    issue_id: id,
    depends_on_id: target,
    type,
  });
  const beads = [
    bead("new-a"),
    bead("new-b"),
    bead("finished", { status: "closed" }),
    bead("linked-a", { dependencies: [dep("linked-a", "linked-b")] }),
    bead("linked-b"),
    bead("epic", { issue_type: "epic" }),
    bead("nested", { issue_type: "epic", dependencies: [dep("nested", "epic", "parent-child")] }),
    bead("child", { dependencies: [dep("child", "nested", "parent-child")] }),
    bead("archived", { labels: ["archived"] }),
  ];

  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let connection;
  await page.route("**/api/p/demo/**", async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    if (pathname.endsWith("/deps") && req.method() === "POST") {
      connection = req.postDataJSON();
      const source = required(beads.find((b) => b.id === "new-b"));
      source.dependencies.push(dep(source.id, connection.depends_on_id));
      return route.fulfill({ json: source });
    }
    if (pathname.endsWith("/beads")) {
      return route.fulfill({
        json: {
          beads,
          meta: {
            kind: "demo",
            humanActor: "reviewer",
            humanAllowlist: ["reviewer"],
            pollIntervalMs: 300000,
            readOnly: false,
          },
        },
      });
    }
    if (pathname.endsWith("/beads/stream")) return route.abort();
    const item = beads.find((b) => pathname.endsWith(`/beads/${b.id}`));
    return route.fulfill({ json: item ?? {} });
  });
  await page.goto(`${base}/p/demo`);
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await page.locator(".react-flow__node").first().waitFor();
  await page.getByRole("checkbox", { name: "Hide completed", exact: true }).uncheck();
  await page.locator('.react-flow__node[data-id="finished"]').waitFor();
  const ids = () =>
    page
      .locator(".react-flow__node")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-id")).sort());
  expect(
    await ids(),
    "Unfiltered graph must include closed and unlinked beads exactly once",
  ).toStrictEqual(
    beads
      .filter((b) => b.id !== "archived")
      .map((b) => b.id)
      .sort(),
  );
  const filter = page.getByRole("checkbox", { name: "Live dependencies only" });
  await filter.check();
  await page.locator('.react-flow__node[data-id="finished"]').waitFor({ state: "detached" });
  expect(await ids()).toStrictEqual(["child", "epic", "linked-a", "linked-b", "nested"]);
  await filter.uncheck();
  const source = page.locator('.react-flow__node[data-id="new-a"] .react-flow__handle.source');
  const target = page.locator('.react-flow__node[data-id="new-b"] .react-flow__handle.target');
  await source.waitFor();
  const a = required(await source.boundingBox());
  const b = required(await target.boundingBox());
  expect(a && b).toBeTruthy();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
  await page
    .locator('.react-flow__edge[data-id="new-b->new-a:blocks"]')
    .waitFor({ state: "attached" });
  expect(connection, "Previously unlinked tasks must still support drag-to-link").toStrictEqual({
    depends_on_id: "new-a",
    type: "blocks",
  });
  await page.locator('.react-flow__node[data-id="finished"]').click();
  await page.getByTitle("Close", { exact: true }).waitFor();
  await page.getByTitle("Close", { exact: true }).click();

  beads.splice(0, beads.length, bead("unlinked"), bead("completed", { status: "closed" }));
  await page.reload();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await page.locator('.react-flow__node[data-id="unlinked"]').waitFor();
  await page.getByRole("checkbox", { name: "Live dependencies only" }).check();
  await page.getByRole("button", { name: "Show all beads", exact: true }).click();
  await page.locator('.react-flow__node[data-id="completed"]').waitFor();
  expect(await ids(), "Empty filter must offer recovery").toStrictEqual(["completed", "unlinked"]);

  beads.splice(0, beads.length, ...Array.from({ length: 40 }, (_, i) => bead(`loose-${i}`)));
  await page.reload();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await page.locator('.react-flow__node[data-id="loose-39"]').waitFor();
  expect((await ids()).length, "Larger graphs must retain every task").toBe(40);
  const positions = await page.locator(".react-flow__node").evaluateAll((nodes) =>
    nodes.map((n) => {
      const matrix = new DOMMatrix(getComputedStyle(n).transform);
      return { x: matrix.m41, y: matrix.m42 };
    }),
  );
  expect(
    new Set(positions.map((p) => p.x)).size > 1,
    "Loose tasks must wrap into multiple columns",
  ).toBeTruthy();
  expect(
    Math.max(...positions.map((p) => p.y)) < 3000,
    "Avoid an excessively tall loose-task column",
  ).toBeTruthy();
  // A tall epic needs a zoom below React Flow's default fit floor.
  beads.splice(
    0,
    beads.length,
    bead("large-epic", { issue_type: "epic" }),
    ...Array.from({ length: 220 }, (_, i) =>
      bead(`large-${i}`, {
        dependencies: [dep(`large-${i}`, "large-epic", "parent-child")],
      }),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await page.locator('.react-flow__node[data-id="large-219"]').waitFor();
  const fits = () =>
    page.evaluate(() => {
      const canvas = document.querySelector(".react-flow");
      if (!canvas) return false;
      const frame = canvas.getBoundingClientRect();
      return [...document.querySelectorAll(".react-flow__node")].every((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.left >= frame.left - 1 &&
          r.right <= frame.right + 1 &&
          r.top >= frame.top - 1 &&
          r.bottom <= frame.bottom + 1
        );
      });
    });
  await page.waitForFunction(() => {
    const n = document.querySelector(".react-flow__viewport");
    return n && new DOMMatrix(getComputedStyle(n).transform).a < 0.1;
  });
  expect((await ids()).length).toBe(221);
  expect(await fits(), "Initial fit must include every node of a large epic").toBeTruthy();
  await page.getByRole("button", { name: /^zoom in$/i }).click();
  await page.getByRole("button", { name: "Center", exact: true }).click();
  await page.waitForTimeout(500);
  expect(await fits(), "Center must use the same low zoom floor").toBeTruthy();
  await page.getByRole("button", { name: /^zoom in$/i }).click();
  await page.getByRole("button", { name: /^fit view$/i }).click();
  await page.waitForTimeout(300);
  expect(await fits(), "Built-in fit control must fit large graphs too").toBeTruthy();
  expect(errors).toStrictEqual([]);
  console.log(
    "PASS: full graph, optional pruning, unique nested epics, drag-to-link, closed-task details, empty-filter recovery, and wrapped layout",
  );
});
