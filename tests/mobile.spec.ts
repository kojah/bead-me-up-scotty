import type { Browser, Page } from "@playwright/test";
import { type Bead, beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

const dep = (id: string) => ({ depends_on_id: id, type: "parent-child" });
const bead = (id: string, extra: Partial<Bead> = {}) =>
  beadSchema.parse({
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
async function setup(browser: Browser, width: number, readOnly = true) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [],
    writes: { path: string; method?: string; body: Record<string, unknown> }[] = [];
  const beads = structuredClone(fixtures);
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
    if (req.method() !== "GET") return respondToWrite();
    function respondToWrite() {
      writes.push({ path, body: req.postDataJSON() });
      expect(readOnly, "read-only interactions must not write").toBe(false);
      if (path.endsWith("/beads") && req.method() === "POST") {
        const created = bead("created", req.postDataJSON());
        beads.push(created);
        return route.fulfill({ json: created });
      }
      return route.fulfill({ json: {} });
    }
    return respondToRead();
    function respondToRead() {
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
    }
  });
  return { context, page, errors, writes };
}
async function noOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: innerWidth,
  }));
  expect(
    widths.body <= widths.viewport + 1,
    `page overflow: ${JSON.stringify(widths)}`,
  ).toBeTruthy();
  const header = page.locator(".view-toolbar");
  if (await header.count())
    expect(
      await header.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "toolbar overflow",
    ).toBeTruthy();
}
async function navigate(page: Page, name: string) {
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: new RegExp(`^${name}(?: \\d+)?$`) })
    .click();
  await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor({ state: "hidden" });
}
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
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
    expect(required(await page.locator("main").boundingBox()).width).toBe(width);
    await noOverflow(page);
    expect(
      await page
        .locator(".task-row")
        .first()
        .evaluate((e) => getComputedStyle(e).touchAction),
    ).toBe("pan-y");
    const scroller = page.locator("main .bd-scroll");
    await swipe(page, { x: 180, y: 650 }, { x: 180, y: 330 });
    expect(await scroller.evaluate((e) => e.scrollTop > 0)).toBeTruthy();
    await page.getByRole("textbox", { name: "Search beads", exact: true }).fill("dependent");
    expect(await page.locator(".task-row").count()).toBe(1);
    await page.getByRole("textbox", { name: "Search beads", exact: true }).fill("");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Open", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    expect(await page.locator('[data-keyboard-bead-id="done"]').count()).toBe(0);
    await page.reload();
    await page.locator(".task-title").first().waitFor();
    expect(await page.locator('[data-keyboard-bead-id="done"]').count()).toBe(0);
    await page.locator('[data-keyboard-bead-id="dependent"] .task-title').click();
    const detail = page.locator(".bead-detail");
    await detail.waitFor();
    await page.waitForTimeout(250);
    const rect = required(await detail.boundingBox());
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(width);
    await page.getByTitle("Close", { exact: true }).click();
    await detail.waitFor({ state: "hidden" });
    await navigate(page, "Graph");
    await page.locator('[data-epic-container="epic"]').waitFor();
    await page.getByLabel("Graph scope").selectOption("epic");
    await page.getByRole("button", { name: "Fit epic", exact: true }).click();
    expect(
      required(await page.locator(".react-flow").boundingBox()).height >= 350,
      "graph has usable canvas height",
    ).toBeTruthy();
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
    expect(
      boxes.first.bottom < boxes.second.top,
      "measured long cards do not overlap",
    ).toBeTruthy();
    expect(
      boxes.second.bottom <= boxes.nested.bottom,
      "measured cards stay inside epic",
    ).toBeTruthy();
    await noOverflow(page);
    const transform = await page.locator(".react-flow__viewport").getAttribute("style");
    await swipe(page, { x: 200, y: 250 }, { x: 270, y: 285 });
    expect(
      await page.locator(".react-flow__viewport").getAttribute("style"),
      "canvas pans by touch",
    ).not.toBe(transform);
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
    expect(await page.getByRole("button", { name: "Open navigation", exact: true }).count()).toBe(
      0,
    );
    await noOverflow(page);
    expect(errors).toStrictEqual([]);
    expect(writes).toStrictEqual([]);
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
  const create = required(await page.locator(".create-bead").boundingBox());
  expect(create.width).toBe(390);
  expect(create.x).toBe(0);
  await page.getByRole("button", { name: "Create bead", exact: true }).click();
  await page.locator('[data-keyboard-bead-id="created"]').waitFor();
  expect(writes.filter((w) => w.path.endsWith("/beads")).length).toBe(1);
  await page.locator('[data-keyboard-bead-id="created"] .task-title').click();
  await page.getByTitle("Edit title & description").waitFor();
  await noOverflow(page);
  await page.getByTitle("Close", { exact: true }).click();
  expect(errors).toStrictEqual([]);
  await context.close();
  console.log("PASS mobile create flow (fixture writes only) and editable detail");
});
