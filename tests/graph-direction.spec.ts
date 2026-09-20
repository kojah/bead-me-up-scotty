import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
test("responsive direction, dependency levels, vertical ports, preference and canvas", async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 940 } });
  const page = await context.newPage();
  const beads = [
    makeBead("epic", { issue_type: "epic", title: "Study rollout" }),
    makeBead("a", { title: "Prepare", dependencies: [dep("epic", "parent-child")] }),
    makeBead("parallel", { title: "Parallel check", dependencies: [dep("epic", "parent-child")] }),
    makeBead("b", {
      title: "Publish",
      dependencies: [dep("epic", "parent-child"), dep("a"), dep("parallel")],
    }),
    makeBead("after", { issue_type: "epic", title: "Follow up", dependencies: [dep("epic")] }),
  ];
  const errors: string[] = [],
    writes: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/telemetry")
      return route.fulfill({ json: { configured: false, enabled: false } });
    if (req.method() !== "GET") {
      writes.push(path);
      return route.abort();
    }
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path.endsWith("/beads"))
      return route.fulfill({
        json: { beads, meta: { kind: "demo", humanAllowlist: [], pollIntervalMs: 300000 } },
      });
    return route.continue();
  });
  await page.goto(`${baseURL}/p/demo?view=graph`);
  const direction = page.getByLabel("Graph direction", { exact: true });
  await expect(direction).toHaveValue("auto");
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "down",
  );
  await page
    .getByRole("button", { name: "Expand epic Study rollout", exact: true })
    .click({ position: { x: 8, y: 8 } });
  await expect(page.locator("[data-readable-edge]")).toHaveCount(3);
  const card = (id: string) => page.locator(`[data-readable-task="${id}"]`);
  const a = await card("a").boundingBox(),
    parallel = await card("parallel").boundingBox(),
    b = await card("b").boundingBox();
  expect(a!.y + a!.height).toBeLessThan(b!.y);
  expect(parallel!.y + parallel!.height).toBeLessThan(b!.y);
  expect(a!.x).toBe(parallel!.x);
  await expect
    .poll(() =>
      page.locator("[data-readable-edge]").evaluateAll((paths) =>
        paths.every((element) => {
          const path = element as SVGPathElement,
            length = path.getTotalLength();
          const start = path.getPointAtLength(0),
            next = path.getPointAtLength(2),
            end = path.getPointAtLength(length),
            previous = path.getPointAtLength(length - 2);
          return (
            Math.abs(start.x - next.x) < 0.1 &&
            next.y > start.y &&
            Math.abs(end.x - previous.x) < 0.1 &&
            end.y > previous.y
          );
        }),
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("top-down-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 940 });
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "down",
  );
  await direction.selectOption("down");
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "down",
  );
  await expect
    .poll(
      async () => (await card("a").boundingBox())!.y === (await card("parallel").boundingBox())!.y,
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("top-down-desktop.png") });
  await card("b")
    .getByRole("button", { name: "Focus dependencies for Publish", exact: true })
    .click();
  const focusBoxes = await page
    .locator(".task-neighborhood-grid > section")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  expect(focusBoxes[0].bottom).toBeLessThanOrEqual(focusBoxes[1].top);
  await page.getByRole("button", { name: "Back to epic view" }).click();
  await page.reload();
  await expect(direction).toHaveValue("down");
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await expect(
    page.locator('.react-flow__node[data-id="a"] .react-flow__handle-bottom'),
  ).toHaveCount(1);
  await expect(
    page.locator('.react-flow__node[data-id="epic"] .react-flow__handle-bottom'),
  ).toHaveCount(1);
  await expect(page.locator('.react-flow__node[data-id="b"] .react-flow__handle-top')).toHaveCount(
    1,
  );
  await expect
    .poll(() =>
      page
        .locator(".react-flow__edge-path")
        .evaluateAll((paths) => paths.every((p) => Boolean(p.getAttribute("d")))),
    )
    .toBe(true);
  await direction.selectOption("right");
  await expect(
    page.locator('.react-flow__node[data-id="a"] .react-flow__handle-right'),
  ).toHaveCount(1);
  await direction.selectOption("auto");
  await page.setViewportSize({ width: 390, height: 940 });
  await expect(
    page.locator('.react-flow__node[data-id="a"] .react-flow__handle-bottom'),
  ).toHaveCount(1);
  expect(errors).toStrictEqual([]);
  expect(writes).toStrictEqual([]);
});

test("direction controls still work with browser storage unavailable", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 940 } });
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "bmus.graph.direction") throw new Error("blocked");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "bmus.graph.direction") throw new Error("blocked");
      return set.call(this, key, value);
    };
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/p/demo?view=graph`);
  const direction = page.getByLabel("Graph direction", { exact: true });
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "down",
  );
  await direction.selectOption("right");
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "right",
  );
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await expect(direction).toHaveValue("right");
  await page.getByRole("button", { name: "Readable view", exact: true }).click();
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "right",
  );
  await direction.selectOption("auto");
  await expect(page.locator("[data-readable-connections]")).toHaveAttribute(
    "data-direction",
    "down",
  );
});
