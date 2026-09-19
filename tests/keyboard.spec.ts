import { type Bead, beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("keyboard", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: `Keyboard ${id}`,
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
    bead("ready-a", { dependencies: [{ type: "related", depends_on_id: "ready-a" }] }),
    bead("ready-b"),
    bead("active", { status: "in_progress" }),
    bead("hidden", { labels: ["archived"] }),
    bead("epic", { issue_type: "epic" }),
    bead("epic-child", { dependencies: [{ type: "parent-child", depends_on_id: "epic" }] }),
  ];
  const writes: unknown[] = [];

  let page!: import("@playwright/test").Page;
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/p/demo/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (req.method() !== "GET") {
        const body = req.postDataJSON();
        writes.push({ path, method: req.method(), body });
        const id = path.split("/")[5],
          target = required(beads.find((b) => b.id === id));
        if (target && body) Object.assign(target, body);
        return route.fulfill({ json: target ?? {} });
      }
      if (path.endsWith("/beads/stream")) return route.abort();
      if (path.endsWith("/beads"))
        return route.fulfill({
          json: {
            beads,
            meta: {
              kind: "demo",
              humanActor: "reviewer",
              humanAllowlist: ["reviewer"],
              pollIntervalMs: 300000,
            },
          },
        });
      return route.fulfill({ json: beads.find((b) => path.endsWith(`/beads/${b.id}`)) ?? {} });
    });
    const selected = () => page.locator('[data-keyboard-bead-id][aria-current="true"]');
    const item = (id: string) => page.locator(`[data-keyboard-bead-id="${id}"]`).first();
    const chord = async (key: string) => {
      await page.keyboard.press("g");
      await page.keyboard.press(key);
    };
    const close = async () => {
      const dialog = page.getByRole("dialog");
      await dialog.getByTitle("Close", { exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    };
    await page.goto(`${base}/p/demo`);
    await item("ready-a").waitFor();
    // Navigation must work even when a clicked sidebar button retains focus.
    await page.getByRole("button", { name: "Board", exact: true }).click();
    const ids = await page
      .locator("[data-keyboard-bead-id]")
      .evaluateAll((es) => es.map((e) => e.dataset.keyboardBeadId));
    expect(!ids.includes("hidden")).toBeTruthy();
    await page.keyboard.press("j");
    await page.waitForFunction(
      (id) => document.activeElement?.getAttribute("data-keyboard-bead-id") === id,
      ids[0],
    );
    await page.keyboard.press("j");
    expect(await selected().first().getAttribute("data-keyboard-bead-id")).toBe(ids[1]);
    await page.keyboard.press("k");
    expect(await selected().first().getAttribute("data-keyboard-bead-id")).toBe(ids[0]);
    for (const key of ["n", "e", "c", "s", "p"]) {
      await page.keyboard.press(key);
      expect(
        await page.getByRole("dialog").count(),
        `read-only ${key} must not open an editor`,
      ).toBe(0);
    }
    expect(writes.length).toBe(0);
    await item("ready-a").focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .getByRole("heading", { name: "Keyboard ready-a", exact: true })
      .waitFor();
    expect(new URL(page.url()).searchParams.get("bead")).toBe("ready-a");
    await close();
    await chord("f");
    await page.getByRole("heading", { name: "Focus", exact: true }).waitFor();
    await page.keyboard.press("j");
    expect(await selected().count(), "Focus cards participate in keyboard selection").toBeTruthy();
    await page.keyboard.press("o");
    await page.getByRole("dialog").waitFor();
    await close();
    await chord("e");
    await item("epic").waitFor();
    await item("epic").focus();
    if ((await item("epic").getAttribute("aria-expanded")) === "true")
      await page.keyboard.press("Space");
    expect(
      await page.locator('[data-keyboard-bead-id="epic-child"]').count(),
      "collapsed epic children are not keyboard candidates",
    ).toBe(0);
    await page.keyboard.press("Space");
    await item("epic-child").waitFor();
    await item("epic").focus();
    await page.keyboard.press("Space");
    expect(await page.locator('[data-keyboard-bead-id="epic-child"]').count()).toBe(0);
    await chord("b");
    await page.keyboard.press("/");
    const search = page.locator("input[data-search]");
    await search.fill("jkgf");
    expect(await search.inputValue()).toBe("jkgf");
    expect(await page.getByRole("heading", { name: "Board", exact: true }).count()).toBe(1);
    await search.fill("");
    await search.press("Tab");
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await page.getByRole("menu").waitFor();
    await chord("f");
    expect(
      await page.getByRole("heading", { name: "Board", exact: true }).count(),
      "an open filter menu suppresses view shortcuts",
    ).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: /keyboard shortcuts/i });
    await help.waitFor();
    await help.getByText("Focus", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Read Only Mode", exact: true }).click();
    await chord("f");
    expect(
      await page.getByRole("heading", { name: "Board", exact: true, includeHidden: true }).count(),
      "viewer dialog suppresses view shortcuts",
    ).toBe(1);
    await page.getByRole("button", { name: "Disable read-only mode", exact: true }).click();
    await page
      .getByRole("button", { name: "Read Only Mode", exact: true })
      .waitFor({ state: "detached" });
    await page.getByRole("dialog").waitFor({ state: "detached" });
    // Editing shortcuts remain useful when explicitly unlocked.
    await item("ready-a").focus();
    await page.keyboard.press("o");
    const draft = page.getByPlaceholder(/^Comment as/);
    await draft.fill("Keep this unsaved draft");
    await page.getByRole("dialog").getByTitle("Open ready-a", { exact: true }).click();
    expect(await draft.inputValue(), "same-bead navigation does not remount the drawer").toBe(
      "Keep this unsaved draft",
    );
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: true } });
    await page.getByRole("button", { name: "Read Only Mode", exact: true }).waitFor();
    expect(await draft.inputValue(), "enabling viewer mode must preserve a comment draft").toBe(
      "Keep this unsaved draft",
    );
    expect(await draft.isDisabled()).toBe(true);
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
    await page
      .getByRole("button", { name: "Read Only Mode", exact: true })
      .waitFor({ state: "detached" });
    expect(await draft.inputValue()).toBe("Keep this unsaved draft");
    await close();
    await item("ready-a").focus();
    await page.keyboard.press("e");
    await page.getByPlaceholder("Title", { exact: true }).waitFor();
    await close();
    await item("ready-a").focus();
    await page.keyboard.press("c");
    await page.getByText("Close reason — optional", { exact: true }).waitFor();
    await close();
    await item("ready-a").focus();
    await page.keyboard.press("s");
    const statusWrite = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/beads/ready-a/status"),
    );
    await page
      .getByRole("dialog")
      .locator("[cmdk-item]")
      .filter({ hasText: /In progress/i })
      .click();
    const statusRequest = await statusWrite;
    expect(statusRequest.postDataJSON().status).toBe("in_progress");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await item("ready-a").focus();
    await page.keyboard.press("p");
    const priorityWrite = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith("/beads/ready-a"),
    );
    await page.getByRole("dialog").locator("[cmdk-item]").filter({ hasText: /P1/ }).click();
    expect((await priorityWrite).postDataJSON().priority).toBe(1);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await item("ready-a").focus();
    await page.keyboard.press("n");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    expect(errors).toStrictEqual([]);
    console.log(
      "PASS: keyboard selection, Focus navigation, input/menu/dialog suppression, read-only guards, and editable issue shortcuts",
    );
  } catch (e) {
    console.error({
      errors,
      url: page?.url(),
      body: page ? (await page.locator("body").innerText()).slice(0, 2500) : "",
    });
    throw e;
  }
});
