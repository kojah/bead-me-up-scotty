import { type Bead, beadSchema } from "../lib/schema";
import { expect, test } from "./fixtures";

test("focus", async ({ browser, baseURL }, testInfo) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: id,
      status: "open",
      issue_type: "task",
      priority: 1,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });
  const dep = (type: string, target: string) => ({ type, depends_on_id: target });
  const beads = [
    bead("upstream", { priority: 3 }),
    bead("waiting", { dependencies: [dep("waits-for", "upstream")], labels: ["ctx:alpha"] }),
    bead("conditional", {
      dependencies: [dep("conditional-blocks", "upstream")],
      labels: ["ctx:beta"],
    }),
    bead("manual", { status: "blocked" }),
    bead("flight", { status: "in_progress", labels: ["ctx:alpha"] }),
    bead("ready", { labels: ["ctx:beta"] }),
    bead("parent", { issue_type: "epic", priority: 3 }),
    bead("child", { dependencies: [dep("parent-child", "parent")] }),
    bead("done", { status: "closed" }),
    bead("archived", { labels: ["archived"] }),
    bead("gate", {
      issue_type: "gate",
      await_type: "human",
      priority: 3,
      dependencies: [dep("waits-for", "upstream")],
    }),
  ];

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  let lanePrefix: string | null = "ctx:";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/p/demo/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path.endsWith("/beads"))
      return route.fulfill({
        json: {
          beads,
          meta: {
            kind: "demo",
            humanActor: "reviewer",
            humanAllowlist: ["reviewer"],
            pollIntervalMs: 1000,
            lanePrefix,
          },
        },
      });
    return route.fulfill({ json: beads.find((b) => path.endsWith(`/beads/${b.id}`)) ?? {} });
  });
  await page.goto(`${base}/p/demo`);
  await page.locator("article").first().waitFor();
  expect(await page.evaluate(() => localStorage.getItem("bmus.view.demo"))).toBe(null);
  expect(
    await page.getByRole("heading", { name: "Focus", exact: true }).count(),
    "Board is first-visit default",
  ).toBe(0);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("heading", { name: "Focus", exact: true }).waitFor();
  const column = (name: string) =>
    page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const ids = async (name: string) =>
    (await column(name).locator("article").allTextContents()).join(" ");
  expect(await ids("Blocked")).toMatch(/waiting/);
  expect(await ids("Blocked")).toMatch(/conditional/);
  expect(await ids("Blocked")).toMatch(/manual/);
  expect(await ids("Blocked")).toMatch(/gate/);
  expect(await ids("Next up")).not.toMatch(/waiting|conditional|gate/);
  expect(await ids("Next up")).toMatch(/child/);
  expect(await ids("Next up")).toMatch(/ready/);
  expect(await ids("In flight")).toMatch(/flight/);
  expect((await page.locator("section article").allTextContents()).join(" ")).not.toMatch(
    /archived|done/,
  );
  await page.screenshot({ path: testInfo.outputPath("scotty-focus-final.png") });
  await page.getByRole("button", { name: "alpha", exact: true }).click();
  expect(await ids("Blocked")).toMatch(/waiting/);
  expect(await ids("Blocked")).not.toMatch(/conditional|manual/);
  expect(await column("Next up").locator("article").count()).toBe(0);
  await page.getByRole("button", { name: "unlabeled", exact: true }).click();
  expect(await ids("Next up")).toMatch(/child/);
  await page.getByRole("button", { name: "All", exact: true }).click();
  const childCard = column("Next up").getByRole("button", { name: "child", exact: true });
  await childCard.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  expect(await page.getByRole("dialog").locator("select").first().isDisabled()).toBe(true);
  await page.getByTitle("Close", { exact: true }).click();
  await page.goto(`${base}/p/demo`); // An ordinary project link uses the default.
  await page.locator("article").first().waitFor();
  expect(await page.getByRole("heading", { name: "Focus", exact: true }).count()).toBe(0);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "alpha", exact: true }).click();
  beads.forEach((b) => {
    b.labels = [];
  });
  // Wait for the normal live polling refresh without remounting Focus.
  await page.waitForFunction(
    () => ![...document.querySelectorAll("button")].some((b) => b.textContent === "alpha"),
  );
  expect(await ids("Next up")).toMatch(/child/);
  expect(await ids("Next up")).toMatch(/ready/);
  lanePrefix = null;
  await page.reload();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("heading", { name: "Focus", exact: true }).waitFor();
  expect(await page.getByRole("button", { name: "alpha", exact: true }).count()).toBe(0);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.reload();
  await page.locator("article").first().waitFor();
  expect(await page.getByRole("heading", { name: "Focus", exact: true }).count()).toBe(0);
  expect(errors).toStrictEqual([]);
  console.log(
    "PASS: Board default, optional Focus, blocking columns, hierarchy, lane filters, archived exclusion, and read-only detail navigation",
  );
});
