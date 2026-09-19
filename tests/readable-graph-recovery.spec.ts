import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("readable graph recovers from empty filters and removed focus with storage unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "bmus.graph.presentation") throw new Error("blocked storage");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "bmus.graph.presentation") throw new Error("blocked storage");
      return set.call(this, key, value);
    };
  });
  const beads = [makeBead("done", { status: "closed", title: "Completed task" })];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/telemetry") return route.fulfill({ json: { ok: true, configured: false } });
    if (route.request().method() !== "GET") return route.abort();
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path.endsWith("/beads"))
      return route.fulfill({ json: { beads, meta: { kind: "demo", pollIntervalMs: 300 } } });
    return route.continue();
  });
  await page.goto("/p/demo?view=graph");
  await page.getByRole("button", { name: "Show completed beads", exact: true }).click();
  await expect(page.locator('[data-readable-task="done"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Focus dependencies for Completed task", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("No prerequisites", { exact: true })).toBeVisible();
  await expect(page.getByText("No dependents", { exact: true })).toBeVisible();
  beads[0].labels = ["archived"];
  await expect(page.getByText("This task is no longer available.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Back to epic view" }).click();
  await expect(page.getByText("No beads to show.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Full graph", exact: true }).click();
  await expect(page.getByRole("button", { name: "Full graph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Readable view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Readable view", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toStrictEqual([]);
});
