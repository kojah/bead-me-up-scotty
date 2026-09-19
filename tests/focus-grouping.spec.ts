import { type Bead, beadSchema } from "../lib/schema";
import { expect, test } from "./fixtures";

test("focus grouping", async ({ browser, baseURL }, testInfo) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  expect((await (await fetch(`${base}/api/telemetry`)).json()).configured).toBe(false);
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
      updated_at: "2026-09-08T00:00:00Z",
      ...extra,
    });
  const dep = (type: string, target: string) => ({ type, depends_on_id: target });
  let beads = [
    bead("source", { priority: 3 }),
    bead("manual-block", { status: "blocked", assignee: "Alice", labels: ["ctx:alpha"] }),
    bead("waiting", { assignee: "Bob", dependencies: [dep("waits-for", "source")] }),
    bead("conditional", { dependencies: [dep("conditional-blocks", "source")] }),
    bead("direct-block", { dependencies: [dep("blocks", "source")] }),
    bead("missing-block", { dependencies: [dep("blocks", "missing")] }),
    bead("flight", { status: "in_progress", assignee: "Alice", labels: ["ctx:alpha"] }),
    bead("hooked", { status: "hooked", assignee: "Bob" }),
    bead("named-unassigned", { status: "in_progress", assignee: "Unassigned" }),
    bead("blank-assignee", { status: "in_progress", assignee: "  " }),
    bead("parent", { issue_type: "epic", priority: 3 }),
    bead("child", { assignee: "Alice", dependencies: [dep("parent-child", "parent")] }),
    bead("resolved", { dependencies: [dep("blocks", "done-1")] }),
    bead("archived-active", { status: "in_progress", labels: ["archived"] }),
    bead("archived-done", {
      status: "closed",
      labels: ["archived"],
      closed_at: "2026-09-30T00:00:00Z",
    }),
    ...Array.from({ length: 12 }, (_, i) =>
      bead(`active-${i}`, { status: "in_progress", assignee: "Alice" }),
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      bead(`blocked-${i}`, { status: "blocked", assignee: "Bob" }),
    ),
    ...Array.from({ length: 9 }, (_, i) =>
      bead(`done-${i + 1}`, {
        status: "closed",
        assignee: i % 2 ? "Bob" : "Alice",
        closed_at: i === 0 ? "invalid" : `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
        updated_at: `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
        labels: i === 0 ? ["ctx:alpha"] : [],
      }),
    ),
  ];

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
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
            readOnly: true,
            pollIntervalMs: 1000,
            lanePrefix: "ctx:",
            humanActor: "reviewer",
            humanAllowlist: ["reviewer"],
          },
        },
      });
    return route.fulfill({ json: beads.find((b) => path.endsWith(`/beads/${b.id}`)) ?? {} });
  });
  await page.goto(`${base}/p/demo?view=focus`);
  const group = page.getByRole("combobox", { name: "Group by" });
  await group.waitFor();
  expect(await group.inputValue()).toBe("none");
  const recent = page.getByRole("button", { name: "Recently finished", exact: true });
  expect(await recent.getAttribute("aria-pressed")).toBe("false");
  const cards = (column: string) => page.locator(`[data-focus-column="${column}"] article`);
  const ids = (column: string) =>
    cards(column).evaluateAll((els) => els.map((e) => e.dataset.keyboardBeadId));
  expect((await ids("flight")).length, "all active work, including hooked, is visible").toBe(16);
  expect((await ids("blocked")).length, "explicit and dependency-blocked work is uncapped").toBe(
    17,
  );
  expect((await ids("next")).includes("child"), "hierarchy does not block").toBeTruthy();
  expect((await ids("next")).includes("resolved"), "completed blockers resolve").toBeTruthy();
  expect(await cards("recent").count()).toBe(0);
  await group.selectOption("assignee");
  const row = (label: string) =>
    page.getByRole("region", { name: `Assignee: ${label}`, exact: true });
  await row("Alice").waitFor();
  expect(await row("Unassigned").locator("article").count()).toBe(1);
  expect(await row("No assignee").locator('[data-keyboard-bead-id="blank-assignee"]').count()).toBe(
    1,
  );
  expect((await ids("flight")).length).toBe(16);
  expect((await ids("blocked")).length).toBe(17);
  expect(await page.locator('[data-keyboard-bead-id="archived-active"]').count()).toBe(0);
  await recent.click();
  expect(await cards("recent").count()).toBe(7);
  await page.getByText("Showing 7 of 9 completed beads").waitFor();
  expect((await ids("recent")).includes("done-9")).toBeTruthy();
  expect(!(await ids("recent")).includes("done-1")).toBeTruthy();
  await page.getByRole("button", { name: "Show all 9 completed", exact: true }).click();
  expect(await cards("recent").count()).toBe(9);
  await page.getByRole("button", { name: "Show latest 7", exact: true }).click();
  expect(await cards("recent").count()).toBe(7);
  await page.getByRole("button", { name: "alpha", exact: true }).click();
  expect(await ids("recent"), "lane filtering happens before the recent cap").toStrictEqual([
    "done-1",
  ]);
  expect(
    await cards("recent").innerText(),
    "invalid completion dates use the valid update time",
  ).not.toMatch(/NaN/);
  expect(await ids("blocked")).toStrictEqual(["manual-block"]);
  await page.getByRole("button", { name: "All", exact: true }).click();
  const childCard = row("Alice").getByRole("button", { name: "child", exact: true });
  await childCard.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  expect(new URL(page.url()).searchParams.get("bead")).toBe("child");
  expect(await page.getByRole("dialog").locator("select").first().isDisabled()).toBe(true);
  await page.getByTitle("Close", { exact: true }).click();
  // Normal polling must move cards between assignees and columns without toggling controls.
  beads = beads.map((b) =>
    b.id === "flight"
      ? { ...b, assignee: "Carol", status: "closed", closed_at: "2026-09-10T00:00:00Z" }
      : b,
  );
  await row("Carol")
    .locator('[data-focus-column="recent"] [data-keyboard-bead-id="flight"]')
    .waitFor();
  expect(await row("Alice").locator('[data-keyboard-bead-id="flight"]').count()).toBe(0);
  await group.selectOption("none");
  expect(await page.getByRole("region", { name: "Assignee: Alice", exact: true }).count()).toBe(0);
  expect((await ids("flight")).length).toBe(15);
  await recent.click();
  expect(await cards("recent").count()).toBe(0);
  await page.setViewportSize({ width: 720, height: 900 });
  await group.selectOption("assignee");
  await row("Alice").waitFor();
  await page.screenshot({ path: testInfo.outputPath("scotty-focus-grouped-narrow.png") });
  expect(errors).toStrictEqual([]);
  console.log(
    "PASS: Focus defaults, assignee grouping, hooked and uncapped blocked work, recent limit/show-all, lanes, keyboard links, read-only details, live updates and narrow layout",
  );
});
