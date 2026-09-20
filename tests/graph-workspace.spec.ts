import type { Page } from "@playwright/test";
import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
const fixture = () => [
  makeBead("epic", { issue_type: "epic", title: "Rollout" }),
  makeBead("nested", { issue_type: "epic", dependencies: [dep("epic", "parent-child")] }),
  makeBead("a", { dependencies: [dep("nested", "parent-child")] }),
  makeBead("b", { dependencies: [dep("epic", "parent-child"), dep("a")] }),
  makeBead("related", { dependencies: [dep("b", "related")] }),
  makeBead("loose"),
  makeBead("done", { status: "closed" }),
  makeBead("archived", { labels: ["archived"] }),
];

async function setup(page: Page, readOnly: boolean) {
  const beads = fixture();
  const writes: { path: string; body: unknown }[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("bmus.graph.presentation", "canvas"));
  await page.route("**/api/**", (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/telemetry") return route.fulfill({ json: { configured: false } });
    if (path === "/api/viewer-mode") return route.fulfill({ json: { readOnly } });
    if (req.method() !== "GET") {
      writes.push({ path, body: req.postDataJSON() });
      expect(readOnly).toBe(false);
      expect(path).toMatch(/\/deps$/);
      const bead = beads.find((b) => b.id === path.split("/").at(-2))!;
      const body = req.postDataJSON();
      bead.dependencies.push(dep(body.depends_on_id, body.type));
      return route.fulfill({ json: bead });
    }
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path.endsWith("/beads"))
      return route.fulfill({
        json: { beads, meta: { kind: "demo", humanAllowlist: [], pollIntervalMs: 300000 } },
      });
    if (/\/beads\/[^/]+$/.test(path))
      return route.fulfill({ json: beads.find((b) => path.endsWith("/" + b.id)) ?? {} });
    return route.continue();
  });
  await page.goto("/p/demo?view=graph");
  return { beads, writes, errors };
}

async function expandAll(page: Page) {
  await page.getByText("Graph options", { exact: true }).click();
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
}

for (const width of [390, 1440]) {
  test(`single graph preserves filters, relations, zoom and creation at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const { writes, errors } = await setup(page, false);
    await expect(page.getByRole("button", { name: /^(Full graph|Readable view)$/ })).toHaveCount(0);
    await expect(page.locator("[data-readable-graph]")).toBeVisible();
    await expandAll(page);
    const card = (id: string) => page.locator(`[data-readable-task="${id}"]`);
    await expect(card("a")).toBeAttached();
    await expect(card("archived")).toHaveCount(0);
    await expect(card("done")).toHaveCount(0);
    await expect(page.locator("[data-readable-edge]")).toHaveCount(1);
    await page.getByLabel("Show other relationships").check();
    await expect(page.locator('[data-readable-edge][data-relationship="other"]')).toHaveCount(1);
    await expect(page.locator('[data-relationship="other"]')).not.toHaveAttribute("marker-end");
    await page.getByLabel("Hide completed", { exact: true }).uncheck();
    await expect(card("done")).toBeAttached();
    await page.getByLabel("Live dependencies only").check();
    await expect(card("done")).toHaveCount(0);
    await expect(card("loose")).toHaveCount(0);
    await expect(card("a")).toBeAttached();
    await page.getByLabel("Live dependencies only").uncheck();
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("80%");
    await expect
      .poll(() =>
        page
          .locator('[data-readable-edge][data-source="a"][data-target="b"]')
          .evaluate((element) => {
            const path = element as SVGPathElement,
              matrix = path.getScreenCTM()!;
            const start = path.getPointAtLength(0).matrixTransform(matrix);
            const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
            const a = document.querySelector('[data-readable-task="a"]')!.getBoundingClientRect();
            const b = document.querySelector('[data-readable-task="b"]')!.getBoundingClientRect();
            return Math.abs(start.y - a.bottom) < 2 && Math.abs(end.y - b.top) < 2;
          }),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Fit graph", exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator(".readable-graph-scroll")
          .evaluate(
            (e) => e.scrollHeight <= e.clientHeight + 2 && e.scrollWidth <= e.clientWidth + 2,
          ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await page.getByText("Add dependency", { exact: true }).click();
    await page.getByLabel("Prerequisite", { exact: true }).selectOption("loose");
    await page.getByLabel("Dependent", { exact: true }).selectOption("loose");
    await expect(page.getByRole("button", { name: "Create dependency" })).toBeDisabled();
    await page.getByLabel("Dependent", { exact: true }).selectOption("b");
    await page.getByRole("button", { name: "Create dependency" }).click();
    await expect
      .poll(() => writes)
      .toEqual([
        { path: "/api/p/demo/beads/b/deps", body: { depends_on_id: "loose", type: "blocks" } },
      ]);
    await expect(
      page.locator('[data-readable-edge][data-source="loose"][data-target="b"]'),
    ).toHaveCount(1);
    await page.getByLabel("Prerequisite", { exact: true }).selectOption("loose");
    await page.getByLabel("Dependent", { exact: true }).selectOption("b");
    await expect(page.getByRole("button", { name: "Create dependency" })).toBeDisabled();
    await page.getByText("Graph options", { exact: true }).click();
    await page.getByLabel("Graph scope").selectOption("epic");
    await expect(
      page.getByRole("region", { name: "Outside epic" }).filter({ has: card("loose") }),
    ).toBeAttached();
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`unified-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test("read-only graph has no editor, recovers empty live filter, and fits a large epic", async ({
  page,
}) => {
  const { beads, errors, writes } = await setup(page, true);
  await expandAll(page);
  await expect(page.getByText("Add dependency", { exact: true })).toHaveCount(0);
  beads.splice(0, beads.length, makeBead("loose"), makeBead("done", { status: "closed" }));
  await page.reload();
  await page.getByText("Graph options", { exact: true }).click();
  await page.getByLabel("Live dependencies only").check();
  await page.getByRole("button", { name: "Show all beads", exact: true }).click();
  await expect(page.locator("[data-readable-task]")).toHaveCount(2);
  beads.splice(
    0,
    beads.length,
    makeBead("large", { issue_type: "epic" }),
    ...Array.from({ length: 220 }, (_, i) =>
      makeBead(`task-${i}`, { dependencies: [dep("large", "parent-child")] }),
    ),
  );
  await page.reload();
  await expandAll(page);
  await expect(page.locator("[data-readable-task]")).toHaveCount(220);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await expect
    .poll(() =>
      page.locator(".readable-graph-scroll").evaluate((e) => e.scrollHeight <= e.clientHeight + 2),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(page.locator("[data-readable-task]")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
