import { type Bead, beadSchema } from "../lib/schema";
import { expect, test } from "./fixtures";

test("graph containers", async ({ browser, baseURL }, testInfo) => {
  const dep = (id: string, type = "parent-child") => ({ depends_on_id: id, type });
  const b = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: id,
      status: "open",
      issue_type: "task",
      priority: 2,
      dependencies: [],
      labels: [],
      ...extra,
    });
  const beads = [
    b("epic", { issue_type: "epic", status: "closed" }),
    b("nested", { issue_type: "epic", dependencies: [dep("epic")] }),
    b("first", { dependencies: [dep("nested")] }),
    b("second", { dependencies: [dep("epic"), dep("first", "blocks")] }),
    b("done", { status: "closed", dependencies: [dep("epic")] }),
    b("standalone"),
  ];
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/p/demo/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/beads/stream")) return route.abort();
    expect(route.request().method(), "browser test must not mutate data").toBe("GET");
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
    return route.fulfill({ json: {} });
  });
  const url = baseURL + "/p/demo?view=graph";
  await page.goto(url);
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  const hide = page.getByRole("checkbox", { name: "Hide completed", exact: true });
  await hide.waitFor();
  expect(await hide.isChecked()).toBeTruthy();
  await page.locator('[data-epic-container="nested"]').waitFor();
  expect(await page.locator('.react-flow__node[data-id="done"]').count()).toBe(0);
  await hide.uncheck();
  await page.locator('.react-flow__node[data-id="done"]').waitFor();
  await page.reload();
  await hide.waitFor();
  expect(await hide.isChecked()).toBe(false);
  await page.locator('.react-flow__node[data-id="done"]').waitFor();
  await hide.check();
  await page.locator('.react-flow__node[data-id="done"]').waitFor({ state: "detached" });
  await page.waitForTimeout(500);
  const boxes = await page
    .locator(".react-flow__node")
    .evaluateAll((ns) =>
      Object.fromEntries(ns.map((n) => [n.dataset.id, n.getBoundingClientRect().toJSON()])),
    );
  for (const [child, parent] of [
    ["first", "nested"],
    ["nested", "epic"],
    ["second", "epic"],
  ]) {
    expect(
      boxes[child].left >= boxes[parent].left && boxes[child].right <= boxes[parent].right + 1,
    ).toBeTruthy();
    expect(
      boxes[child].top > boxes[parent].top && boxes[child].bottom <= boxes[parent].bottom + 1,
    ).toBeTruthy();
  }
  expect(boxes.first.x < boxes.second.x).toBeTruthy();
  expect(await page.locator('.react-flow__edge[data-id*="parent-child"]').count()).toBe(0);
  expect(await page.locator('.react-flow__edge[data-id="second->first:blocks"]').count()).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("epic-containers.png") });
  expect(errors).toStrictEqual([]);
  console.log("Browser containment, arrows, completed filtering and reload persistence passed");
});
