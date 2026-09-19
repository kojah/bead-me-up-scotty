import { type Bead, beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("graph epic", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const dep = (target: string, type = "parent-child") => ({ depends_on_id: target, type });
  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: id,
      status: "open",
      issue_type: "task",
      priority: 2,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      labels: [],
      dependencies: [],
      ...extra,
    });
  const beads = [
    bead("epic", { issue_type: "epic" }),
    bead("child", { dependencies: [dep("epic"), dep("grandchild")] }),
    bead("nested", { issue_type: "epic", dependencies: [dep("child")] }),
    bead("grandchild", { dependencies: [dep("nested"), dep("outside", "blocks")] }),
    ...Array.from({ length: 7 }, (_, i) => bead(`sub-${i}`, { dependencies: [dep("child")] })),
    bead("long-title", {
      title:
        "A long descriptive task title with enough detail to wrap across many lines while retaining every word and remaining readable without overlapping the following task card. ".repeat(
          3,
        ),
      dependencies: [dep("child")],
    }),
    bead("outside"),
    bead("external-dependent", { dependencies: [dep("child", "waits-for")] }),
    bead("external-related", { dependencies: [dep("grandchild", "related")] }),
    bead("solo"),
    bead("archived", { labels: ["archived"], dependencies: [dep("epic")] }),
    bead("closed-epic", { issue_type: "epic", status: "closed" }),
    bead("closed-child", { status: "closed", dependencies: [dep("closed-epic")] }),
  ];
  const writes: unknown[] = [];
  const errors: string[] = [];

  let page!: import("@playwright/test").Page;
  try {
    const context = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/p/demo/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path.endsWith("/beads/stream")) return route.abort();
      if (path.endsWith("/deps") && req.method() === "POST") {
        const id = path.split("/").at(-2),
          body = req.postDataJSON();
        writes.push({ id, ...body });
        const b = required(beads.find((b) => b.id === id));
        b.dependencies.push(dep(body.depends_on_id, body.type));
        return route.fulfill({ json: b });
      }
      if (path.endsWith("/beads"))
        return route.fulfill({
          json: {
            beads,
            meta: {
              kind: "demo",
              humanActor: "reviewer",
              humanAllowlist: ["reviewer"],
              pollIntervalMs: 300000,
            },
          },
        });
      return route.fulfill({ json: beads.find((b) => path.endsWith(`/beads/${b.id}`)) ?? {} });
    });
    const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
    const ids = () =>
      page.locator(".react-flow__node").evaluateAll((ns) => ns.map((n) => n.dataset.id).sort());
    const scope = () => page.getByLabel("Graph scope", { exact: true });
    const close = async () => {
      await page.getByTitle("Close", { exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
    };
    const graph = async () => {
      await page.goto(`${base}/p/demo`);
      await page.getByRole("button", { name: "Graph", exact: true }).click();
      await node("solo").waitFor();
    };
    await graph();
    await page.getByRole("checkbox", { name: "Hide completed", exact: true }).uncheck();
    await node("closed-child").waitFor();
    expect(await scope().inputValue(), "whole graph is the default").toBe("");
    expect(await ids()).toStrictEqual(
      beads
        .filter((b) => b.id !== "archived")
        .map((b) => b.id)
        .sort(),
    );
    await scope().selectOption("epic");
    await node("solo").waitFor({ state: "detached" });
    const expected = beads
      .filter((b) => !["solo", "archived", "closed-epic", "closed-child"].includes(b.id))
      .map((b) => b.id)
      .sort();
    expect(
      await ids(),
      "scope retains root, all nested descendants and external relationships exactly once",
    ).toStrictEqual(expected);
    for (const id of ["outside", "external-dependent", "external-related"])
      await node(id).getByText("Outside epic", { exact: true }).waitFor();
    await page.getByRole("button", { name: /^(Center|Fit epic)$/ }).click();
    await page.waitForTimeout(500);
    const rectangles = await page
      .locator(".react-flow__node")
      .evaluateAll((ns) =>
        ns.map((n) => ({ id: n.dataset.id, ...n.getBoundingClientRect().toJSON() })),
      );
    for (let i = 0; i < rectangles.length; i++)
      for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i],
          b = rectangles[j];
        if (
          required(beads.find((n) => n.id === a.id))?.issue_type === "epic" ||
          required(beads.find((n) => n.id === b.id))?.issue_type === "epic"
        )
          continue;
        expect(
          a.right <= b.left + 1 ||
            b.right <= a.left + 1 ||
            a.bottom <= b.top + 1 ||
            b.bottom <= a.top + 1,
          `nodes must not overlap: ${a.id} / ${b.id}`,
        ).toBeTruthy();
      }
    const displayed = new Set(expected);
    const edgeIds = await page
      .locator(".react-flow__edge")
      .evaluateAll((es) => es.map((e) => e.dataset.id).sort());
    const expectedEdges = beads
      .filter((b) => displayed.has(b.id))
      .flatMap((b) =>
        b.dependencies
          .filter((d) => d.type !== "parent-child" && displayed.has(d.depends_on_id))
          .map((d) => `${b.id}->${d.depends_on_id}:${d.type}`),
      )
      .sort();
    expect(
      edgeIds,
      "all in-scope and boundary dependency edges are retained with canonical IDs",
    ).toStrictEqual(expectedEdges);
    expect(
      await page.locator('.react-flow__edge[data-id*="parent-child"]').count(),
      "containment replaces hierarchy edges",
    ).toBe(0);
    const boxes = Object.fromEntries(rectangles.map((r) => [r.id, r]));
    expect(
      boxes.outside.x < boxes.grandchild.x,
      "prerequisite appears left of dependent",
    ).toBeTruthy();
    await node("sub-6").click();
    await page.getByRole("heading", { name: "sub-6", exact: true }).waitFor();
    await close();
    const spotlight = page.getByRole("checkbox", { name: "Spotlight dependencies", exact: true });
    await spotlight.check();
    await page.getByText(/double-click for details/).waitFor();
    await node("grandchild").click();
    await page.getByTitle("Clear the dependency spotlight").waitFor();
    expect(
      Number(
        await node("outside")
          .locator("[data-keyboard-bead-id]")
          .evaluate((n) => getComputedStyle(n).opacity),
      ) >= 0.99,
      "spotlight includes external blockers despite reversed visual edge direction",
    ).toBeTruthy();
    await spotlight.uncheck();
    expect(writes, "read-only graph browsing does not write").toStrictEqual([]);
    await scope().selectOption("closed-epic");
    await node("closed-child").waitFor();
    expect(await ids()).toStrictEqual(["closed-child", "closed-epic"]);
    const live = page.getByRole("checkbox", { name: "Live dependencies only", exact: true });
    await live.check();
    await node("closed-child").waitFor({ state: "detached" });
    await live.uncheck();
    await node("closed-child").waitFor();
    await scope().selectOption("");
    await node("solo").waitFor();
    expect((await ids()).length, "scope exit restores the full graph").toBe(beads.length - 1);
    // Explicitly unlock only this isolated browser session for link direction checks.
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
    await graph();
    await scope().selectOption("epic");
    await node("solo").waitFor({ state: "detached" });
    const connect = async (sourceId: string, targetId: string) => {
      const source = node(sourceId).locator(".react-flow__handle.source"),
        target = node(targetId).locator(".react-flow__handle.target");
      await page.getByRole("button", { name: /^(Center|Fit epic)$/ }).click();
      await page.waitForTimeout(500);
      const a = required(await source.boundingBox()),
        b = required(await target.boundingBox());
      expect(a && b).toBeTruthy();
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/deps") && r.request().method() === "POST",
      );
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
      await page.mouse.up();
      await response;
    };
    await connect("outside", "sub-4");
    expect(writes.at(-1), "epic mode draws prerequisite to dependent").toStrictEqual({
      id: "sub-4",
      depends_on_id: "outside",
      type: "blocks",
    });
    await scope().selectOption("");
    await node("solo").waitFor();
    await connect("sub-5", "solo");
    expect(writes.at(-1), "whole graph draws prerequisite to dependent").toStrictEqual({
      id: "solo",
      depends_on_id: "sub-5",
      type: "blocks",
    });
    await scope().selectOption("epic");
    await node("closed-epic").waitFor({ state: "detached" });
    required(beads.find((b) => b.id === "epic")).labels = ["archived"];
    await connect("outside", "sub-0");
    await node("closed-epic").waitFor();
    expect(await scope().inputValue(), "archiving the selected epic returns to All beads").toBe("");
    expect(errors).toStrictEqual([]);
    console.log(
      "PASS: recursive epic scope, cycles, full edges, external context, long titles, closed scopes, spotlight, scope exit, and both link directions",
    );
  } catch (e) {
    console.error({ writes, errors, url: page?.url() });
    throw e;
  }
});
