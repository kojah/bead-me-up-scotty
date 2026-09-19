import { type Bead, beadSchema } from "../lib/schema";
import { expect, test } from "./fixtures";

test("bead links", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const bead = (id: string, title: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title,
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });
  const beads = [
    bead("parent", "Parent bead", { issue_type: "epic" }),
    bead("child", "Child bead", {
      dependencies: [{ type: "parent-child", depends_on_id: "parent" }],
    }),
    bead("dependency", "Dependency bead"),
    bead("blocked", "Blocked bead", {
      dependencies: [{ type: "blocks", depends_on_id: "dependency" }],
    }),
  ];

  let page!: import("@playwright/test").Page;
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const copied: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copied.push(text);
          },
        },
      });
      window.__copiedLinks = copied;
    });

    let failBeadsLoad = false;
    await page.route("**/api/viewer-mode", (route) => route.fulfill({ json: { readOnly: true } }));
    await page.route("**/api/p/demo/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/beads/stream")) return route.abort();
      if (path.endsWith("/beads")) {
        if (failBeadsLoad)
          return route.fulfill({ status: 500, json: { error: "fixture data load failed" } });
        return route.fulfill({
          json: {
            beads,
            meta: {
              kind: "demo",
              humanActor: "reviewer",
              humanAllowlist: ["reviewer"],
              pollIntervalMs: 250,
            },
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    // First visit remains Board; opening through a query preserves unrelated URL state.
    await page.goto(`${base}/p/demo?bead=child&custom=keep#anchor`);
    await page.getByRole("dialog").getByText("Child bead", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("bead")).toBe("child");
    expect(
      await page.getByRole("heading", { name: "Focus", exact: true }).count(),
      "a query-opened drawer must not opt into Focus",
    ).toBe(0);
    await page.reload();
    await page.getByRole("dialog").getByText("Child bead", { exact: true }).waitFor();
    expect(page.url(), "reload retains the exact share URL").toBe(
      `${base}/p/demo?bead=child&custom=keep#anchor`,
    );

    // Parent and dependency navigation update the visible bead query; drawer Back restores it.
    await page.getByRole("dialog").getByText("Parent bead", { exact: true }).click();
    await page.getByRole("dialog").getByText("Parent bead", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("bead")).toBe("parent");
    await page.getByTitle("Back to child").click();
    await page.getByRole("dialog").getByText("Child bead", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("bead")).toBe("child");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("article").filter({ hasText: "blocked" }).click();
    await page.getByRole("dialog").getByText("Blocked bead", { exact: true }).waitFor();
    await page.getByRole("dialog").getByText("Dependency bead", { exact: true }).click();
    await page.getByRole("dialog").getByText("Dependency bead", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("bead")).toBe("dependency");
    await page.getByTitle("Back to blocked").click();
    await page.getByRole("dialog").getByText("Blocked bead", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("bead")).toBe("blocked");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    const closed = new URL(page.url());
    expect(closed.searchParams.get("bead")).toBe(null);
    expect(closed.searchParams.get("custom")).toBe("keep");
    expect(closed.hash).toBe("#anchor");

    // The header copy action must be present under read-only mode and emit a canonical link.
    await page.locator("article").filter({ hasText: "child" }).click();
    const copy = page.getByTitle("Copy link", { exact: true });
    await copy.waitFor();
    await copy.click();
    await page.getByText(/Link copied|Copied link/i).waitFor();
    expect(await page.evaluate(() => window.__copiedLinks)).toStrictEqual([
      `${base}/p/demo?bead=child`,
    ]);

    // A missing query bead is reported only after the initial successful list load,
    // removed without touching other query/hash state, and is not re-notified by polling.
    await page.goto(`${base}/p/demo?bead=missing&custom=still#anchor`);
    await page.getByText("Bead missing not found in this project", { exact: true }).waitFor();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("bead") === null);
    const missingUrl = new URL(page.url());
    expect(missingUrl.searchParams.get("custom")).toBe("still");
    expect(missingUrl.hash).toBe("#anchor");
    await page.waitForTimeout(800);
    expect(
      await page.getByText("Bead missing not found in this project", { exact: true }).count(),
      "polling must not duplicate the missing-bead toast",
    ).toBe(1);

    // A failed initial list fetch is an error, not evidence that an id is missing.
    failBeadsLoad = true;
    await page.goto(`${base}/p/demo?bead=unloaded&custom=keep#anchor`);
    await page.getByText(/fixture data load failed|Failed to load|Error/i).waitFor();
    expect(
      await page.getByText("Bead unloaded not found in this project", { exact: true }).count(),
    ).toBe(0);
    expect(
      new URL(page.url()).searchParams.get("bead"),
      "a failed load must leave the link intact",
    ).toBe("unloaded");
    expect(errors).toStrictEqual([]);
    console.log(
      "PASS: query drawer links, trail synchronization, read-only copy link, missing feedback, and failed-load guard",
    );
  } catch (error) {
    console.error({
      errors,
      url: page?.url(),
      body: page ? (await page.locator("body").innerText()).slice(0, 3000) : "",
    });
    throw error;
  }
});
