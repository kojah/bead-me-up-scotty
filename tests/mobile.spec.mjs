import assert from "node:assert/strict";
import { test } from "./fixtures.mjs";

const dep = (id) => ({ depends_on_id: id, type: "parent-child" });
const bead = (id, extra = {}) => ({
  id,
  title: `Task ${id}`,
  status: "open",
  issue_type: "task",
  priority: 2,
  labels: [],
  dependencies: [],
  description: "A mobile test task.",
  ...extra,
});
const fixtures = [
  bead("epic", { issue_type: "epic", title: "Ship a coherent mobile experience" }),
  bead("nested", { issue_type: "epic", dependencies: [dep("epic")] }),
  bead("first", {
    title: "A deliberately very long title ".repeat(12),
    dependencies: [dep("nested")],
  }),
  bead("second", { dependencies: [dep("nested")] }),
  bead("dependent", { dependencies: [dep("epic"), { depends_on_id: "first", type: "blocks" }] }),
  bead("done", { status: "closed", dependencies: [dep("epic")] }),
  ...Array.from({ length: 25 }, (_, i) => bead(`task-${i}`)),
];
async function setup(browser, width, readOnly = true) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [],
    writes = [];
  let beads = structuredClone(fixtures);
  page.on("pageerror", (e) => errors.push(e.message));
  // No board/project mutations leave the browser: reads and writes use fixtures.
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/telemetry") return route.fulfill({ json: { ok: true } });
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path === "/api/viewer-mode") return route.fulfill({ json: { readOnly } });
    if (path === "/api/projects")
      return route.fulfill({
        json: {
          projects: [
            { id: "demo", name: "Demo", hasBeads: true },
            { id: "mobile-test", name: "Another mobile project", hasBeads: true },
          ],
        },
      });
    if (req.method() !== "GET") {
      writes.push({ path, body: req.postDataJSON() });
      assert.equal(readOnly, false, "read-only interactions must not write");
      if (path.endsWith("/beads") && req.method() === "POST") {
        const created = bead("created", req.postDataJSON());
        beads.push(created);
        return route.fulfill({ json: created });
      }
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/beads"))
      return route.fulfill({
        json: {
          beads,
          meta: {
            kind: "demo",
            humanActor: "tester",
            humanAllowlist: ["tester"],
            pollIntervalMs: 300000,
          },
        },
      });
    if (/\/beads\/[^/]+$/.test(path))
      return route.fulfill({ json: beads.find((b) => path.endsWith("/" + b.id)) });
    if (path.endsWith("/order")) return route.fulfill({ json: { orders: {} } });
    return route.continue(); // Other read-only endpoints use the demo server.
  });
  return { context, page, errors, writes };
}
async function noOverflow(page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(widths.body <= widths.viewport + 1, `page overflow: ${JSON.stringify(widths)}`);
  const header = page.locator(".view-toolbar");
  if (await header.count())
    assert.ok(await header.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "toolbar overflow");
}
async function navigate(page, name) {
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: new RegExp(`^${name}(?: \\d+)?$`) })
    .click();
  await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor({ state: "hidden" });
}
async function swipe(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / 10,
          y: from.y + ((to.y - from.y) * i) / 10,
        },
      ],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(200);
}
for (const width of [360, 390, 430]) {
  test(`mobile layout and gestures at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const base = baseURL;
    const { context, page, errors, writes } = await setup(browser, width);
    await page.goto(base + "/p/demo");
    await page.getByRole("heading", { name: "List", exact: true }).waitFor();
    await page.locator(".task-title").first().waitFor();
    assert.equal((await page.locator("main").boundingBox()).width, width);
    await noOverflow(page);
    assert.equal(
      await page
        .locator(".task-row")
        .first()
        .evaluate((e) => getComputedStyle(e).touchAction),
      "pan-y",
    );
    const scroller = page.locator("main .bd-scroll");
    await swipe(page, { x: 180, y: 650 }, { x: 180, y: 330 });
    assert.ok(await scroller.evaluate((e) => e.scrollTop > 0));
    await page.getByRole("textbox", { name: "Search beads", exact: true }).fill("dependent");
    assert.equal(await page.locator(".task-row").count(), 1);
    await page.getByRole("textbox", { name: "Search beads", exact: true }).fill("");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Open", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await page.locator('[data-keyboard-bead-id="done"]').count(), 0);
    await page.reload();
    await page.locator(".task-title").first().waitFor();
    assert.equal(await page.locator('[data-keyboard-bead-id="done"]').count(), 0);
    await page.locator('[data-keyboard-bead-id="dependent"] .task-title').click();
    const detail = page.locator(".bead-detail");
    await detail.waitFor();
    await page.waitForTimeout(250);
    const rect = await detail.boundingBox();
    assert.equal(rect.x, 0);
    assert.equal(rect.width, width);
    await page.getByTitle("Close", { exact: true }).click();
    await detail.waitFor({ state: "hidden" });
    await navigate(page, "Graph");
    await page.locator('[data-epic-container="epic"]').waitFor();
    await page.getByLabel("Graph scope").selectOption("epic");
    await page.getByRole("button", { name: "Fit epic", exact: true }).click();
    assert.ok(
      (await page.locator(".react-flow").boundingBox()).height >= 350,
      "graph has usable canvas height",
    );
    await page.getByRole("button", { name: "Graph options", exact: true }).click();
    await page.getByRole("checkbox", { name: "Hide completed", exact: true }).uncheck();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.locator('.react-flow__node[data-id="done"]').waitFor();
    await page.waitForTimeout(400);
    const boxes = await page
      .locator(".react-flow__node")
      .evaluateAll((ns) =>
        Object.fromEntries(ns.map((n) => [n.dataset.id, n.getBoundingClientRect().toJSON()])),
      );
    assert.ok(boxes.first.bottom < boxes.second.top, "measured long cards do not overlap");
    assert.ok(boxes.second.bottom <= boxes.nested.bottom, "measured cards stay inside epic");
    await noOverflow(page);
    const transform = await page.locator(".react-flow__viewport").getAttribute("style");
    await swipe(page, { x: 200, y: 250 }, { x: 270, y: 285 });
    assert.notEqual(
      await page.locator(".react-flow__viewport").getAttribute("style"),
      transform,
      "canvas pans by touch",
    );
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("mobile-graph.png") });
    for (const view of [
      "Board",
      "Epics",
      "Focus",
      "Activity",
      "Needs You",
      "Insights",
      "Settings",
    ]) {
      await navigate(page, view);
      await page.getByRole("heading", { name: view, exact: true }).waitFor();
      await noOverflow(page);
    }
    await page.locator('.mobile-app-header [data-slot="dropdown-menu-trigger"]').click();
    await page.getByRole("menuitem", { name: "Another mobile project" }).click();
    await page.waitForURL("**/p/mobile-test");
    await page.getByRole("heading", { name: "List", exact: true }).waitFor();
    await page.setViewportSize({ width: 1200, height: 844 });
    await page.getByRole("navigation", { name: "Views" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Open navigation", exact: true }).count(),
      0,
    );
    await noOverflow(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    await context.close();
    console.log(
      `PASS mobile ${width}px: default view, filters/reload, details, graph, navigation, project switch, resize`,
    );
  });
}
test("mobile task creation and editing", async ({ browser, baseURL }) => {
  const base = baseURL;
  const { context, page, errors, writes } = await setup(browser, 390, false);
  await page.goto(base + "/p/demo?view=list");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByPlaceholder("What needs doing?").fill("Created from mobile");
  await page.waitForTimeout(250);
  const create = await page.locator(".create-bead").boundingBox();
  assert.equal(create.width, 390);
  assert.equal(create.x, 0);
  await page.getByRole("button", { name: "Create bead", exact: true }).click();
  await page.locator('[data-keyboard-bead-id="created"]').waitFor();
  assert.equal(writes.filter((w) => w.path.endsWith("/beads")).length, 1);
  await page.locator('[data-keyboard-bead-id="created"] .task-title').click();
  await page.getByTitle("Edit title & description").waitFor();
  await noOverflow(page);
  await page.getByTitle("Close", { exact: true }).click();
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS mobile create flow (fixture writes only) and editable detail");
});
