import {
  filtersFromSearchParams as parse,
  writeFiltersToSearchParams as write,
} from "../lib/filters";
import { type Bead, beadSchema } from "../lib/schema";
import { expect, test } from "./fixtures";

test("url navigation", async ({ browser, baseURL }) => {
  const parsed = parse(
    new URLSearchParams(
      "status=open&status=bad&type=task&type=no&priority=0&priority=4&priority=4&priority=5&priority=%20&priority=1.5&origin=human&origin=unknown&label=a%26b&label=a%26b&assignee=&assignee=__unassigned__&q=hello",
    ),
  );
  expect(JSON.parse(JSON.stringify(parsed))).toStrictEqual({
    status: ["open"],
    type: ["task"],
    priority: [0, 4],
    origin: ["human"],
    labels: ["a&b"],
    assignee: ["", "__unassigned__"],
    search: "hello",
  });
  const roundtrip = new URLSearchParams("view=list&bead=alpha&custom=keep&archived=1&done=7");
  write(roundtrip, parsed);
  expect(JSON.parse(JSON.stringify(parse(roundtrip)))).toStrictEqual(
    JSON.parse(JSON.stringify(parsed)),
  );
  for (const [key, value] of [
    ["view", "list"],
    ["bead", "alpha"],
    ["custom", "keep"],
    ["archived", "1"],
    ["done", "7"],
  ])
    expect(roundtrip.get(key)).toBe(value);

  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: `Task ${id}`,
      status: "open",
      issue_type: "task",
      priority: 1,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });
  const beads = [
    bead("alpha", { assignee: "Alice", labels: ["a&b"] }),
    bead("beta", { assignee: "Bob" }),
    bead("blank"),
    bead("literal", { assignee: "__unassigned__" }),
    bead("archived", { labels: ["archived"] }),
    bead("recent", { assignee: "Carol", status: "closed", closed_at: new Date().toISOString() }),
    bead("old", { assignee: "Carol", status: "closed", closed_at: "2020-01-01T00:00:00Z" }),
  ];

  let page!: import("@playwright/test").Page;
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/p/demo/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      expect(route.request().method(), "navigation must not mutate project data").toBe("GET");
      if (path.endsWith("/beads/stream")) return route.abort();
      return route.fulfill({
        json: path.endsWith("/beads")
          ? {
              beads,
              meta: {
                kind: "demo",
                humanActor: "reviewer",
                humanAllowlist: ["reviewer"],
                pollIntervalMs: 300000,
              },
            }
          : {},
      });
    });
    const heading = (name: string) => page.getByRole("heading", { name, exact: true }).waitFor();
    const nav = async (name: string) => {
      await page.getByRole("button", { name, exact: true }).click();
      await heading(name);
    };
    const search = () => page.locator("input[data-search]");
    const expectIds = async (expected: string[]) => {
      await page.waitForFunction(
        (wanted) =>
          JSON.stringify(
            [
              ...new Set(
                [...document.querySelectorAll<HTMLElement>("main [data-keyboard-bead-id]")].map(
                  (n) => n.dataset.keyboardBeadId,
                ),
              ),
            ].sort(),
          ) === JSON.stringify(wanted),
        [...expected].sort(),
      );
    };
    const params = () => new URL(page.url()).searchParams;
    await page.goto(`${base}/p/demo?view=list&assignee=&custom=keep#anchor`);
    await heading("List");
    await expectIds(["blank"]);
    await nav("Board");
    await expectIds(["blank"]);
    expect(params().get("assignee")).toBe("");
    expect(new URL(page.url()).hash).toBe("#anchor");
    await page.reload();
    await heading("Board");
    await expectIds(["blank"]);
    await page.goBack();
    await heading("List");
    await expectIds(["blank"]);
    await page.goForward();
    await heading("Board");
    await page.getByTitle("Clear all filters", { exact: true }).click();
    await expectIds(["alpha", "beta", "blank", "literal", "recent", "old"]);
    await page.evaluate(() => {
      window.__navigationMarker = "same document";
    });
    await search().fill("Task");
    await search().fill("Task alpha");
    await expectIds(["alpha"]);
    await page.goBack();
    await expectIds(["alpha", "beta", "blank", "literal", "recent", "old"]);
    expect(await search().inputValue()).toBe("");
    await page.goForward();
    await expectIds(["alpha"]);
    expect(await search().inputValue()).toBe("Task alpha");
    expect(await page.evaluate(() => window.__navigationMarker)).toBe("same document");
    // A bookmark's existing search gets a new edit entry, rather than being replaced.
    await page.goto(`${base}/p/demo?view=list&q=Task`);
    await heading("List");
    await search().fill("Task beta");
    await expectIds(["beta"]);
    await page.goBack();
    await heading("List");
    expect(await search().inputValue()).toBe("Task");
    // Clear All is one atomic entry and preserves the independent Done window.
    await page.goto(
      `${base}/p/demo?view=board&archived=1&assignee=Alice&label=a%26b&done=7&custom=keep#anchor`,
    );
    await heading("Board");
    await expectIds(["alpha"]);
    await page.getByTitle("Clear all filters", { exact: true }).click();
    await expectIds(["alpha", "beta", "blank", "literal", "recent"]);
    expect(params().get("done")).toBe("7");
    expect(params().get("archived")).toBe(null);
    expect(params().get("custom")).toBe("keep");
    await page.goBack();
    await expectIds(["alpha"]);
    expect(params().get("archived")).toBe("1");
    expect(params().get("label")).toBe("a&b");
    await page.goForward();
    await expectIds(["alpha", "beta", "blank", "literal", "recent"]);
    await page
      .locator("select")
      .filter({ has: page.locator('option[value="365"]') })
      .selectOption("");
    await expectIds(["alpha", "beta", "blank", "literal", "recent", "old"]);
    expect(params().get("done")).toBe(null);
    await page.goto(`${base}/p/demo?view=board&done=nonsense&assignee=__unassigned__`);
    await heading("Board");
    await expectIds(["literal"]);
    await page.goto(`${base}/p/demo?view=invalid`);
    await heading("Board");
    await page.goto(`${base}/p/demo?view=focus`);
    await heading("Focus");
    // Real Back/Forward restores drawer ids recorded alongside view/filter entries.
    await page.goto(`${base}/p/demo?view=board&bead=alpha&custom=keep#anchor`);
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Task alpha", { exact: true }).waitFor();
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set("view", "list");
      url.searchParams.set("bead", "beta");
      history.pushState(null, "", url);
    });
    await page.goBack();
    await dialog.getByText("Task alpha", { exact: true }).waitFor();
    await page.goForward();
    await dialog.getByText("Task beta", { exact: true }).waitFor();
    expect(params().get("bead")).toBe("beta");
    await page.goBack();
    await dialog.getByText("Task alpha", { exact: true }).waitFor();
    // A history change with the same bead preserves the actual editable draft.
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
    await page
      .getByRole("button", { name: "Read Only Mode", exact: true })
      .waitFor({ state: "detached" });
    const draft = page.getByPlaceholder(/^Comment as/);
    await draft.fill("Keep draft across history");
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set("q", "alpha");
      history.pushState(null, "", url);
    });
    await page.goBack();
    expect(await draft.inputValue()).toBe("Keep draft across history");
    await page.goForward();
    expect(await draft.inputValue()).toBe("Keep draft across history");
    expect(params().get("custom")).toBe("keep");
    expect(new URL(page.url()).hash).toBe("#anchor");
    expect(errors).toStrictEqual([]);
    console.log(
      "PASS: URL parsing, shared filters, explicit views/default fallback, search history, atomic clear, Done window, browser Back/Forward, drawer restoration and draft preservation",
    );
  } catch (error) {
    console.error({
      url: page?.url(),
      body: page ? (await page.locator("body").innerText()).slice(0, 3000) : "",
    });
    throw error;
  }
});
