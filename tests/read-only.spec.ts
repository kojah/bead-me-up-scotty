import type { BrowserContext } from "@playwright/test";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("read only", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const context = await browser.newContext();
  const other = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const mode = await context.request.get(`${base}/api/viewer-mode`);
  expect(mode.status(), "Browser-session mode API must exist").toBe(200);
  expect((await mode.json()).readOnly).toBe(true);
  expect(
    (
      await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: "false" } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.put(`${base}/api/viewer-mode`, {
        data: { readOnly: false },
        headers: { Origin: "https://unrelated.example" },
      })
    ).status(),
  ).toBe(403);
  const write = (ctx: BrowserContext) =>
    ctx.request.post(`${base}/api/p/demo/beads`, {
      data: { title: "Viewer regression sample", issue_type: "task", priority: 2 },
    });
  expect((await write(context)).status()).toBe(403);
  for (const [method, path] of [
    ["PATCH", "beads/example"],
    ["DELETE", "beads/example"],
    ["POST", "attachments"],
    ["PUT", "order"],
    ["POST", "publish"],
  ]) {
    expect(
      (await context.request.fetch(`${base}/api/p/demo/${path}`, { method, data: {} })).status(),
    ).toBe(403);
  }
  await page.goto(`${base}/p/demo`);
  const banner = page.getByRole("button", { name: "Read Only Mode", exact: true });
  await banner.waitFor();
  const small = required(await banner.boundingBox()).height;
  await banner.click();
  await page.getByRole("radio", { name: /^large$/i }).check();
  await page.getByLabel("Background color", { exact: true }).fill("#123456");
  await page.getByLabel("Text color", { exact: true }).fill("#ffffff");
  await page.getByRole("button", { name: "Keep read-only mode", exact: true }).click();
  expect(required(await banner.boundingBox()).height > small).toBeTruthy();
  await page.reload();
  await banner.waitFor();
  expect(await banner.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(18, 52, 86)");
  expect(await banner.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(255, 255, 255)");
  expect(required(await banner.boundingBox()).height > small).toBeTruthy();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  expect(await page.getByRole("button", { name: "New", exact: true }).count()).toBe(0);
  await page.locator("article").first().click();
  expect(await page.getByRole("dialog").locator("select").first().isDisabled()).toBe(true);
  expect(await page.getByLabel("Add label", { exact: true }).isDisabled()).toBe(true);
  expect(await page.getByPlaceholder(/^Comment as/).isDisabled()).toBe(true);
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect(await page.getByRole("button", { name: "Publish site", exact: true }).isDisabled()).toBe(
    true,
  );
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").waitFor();
  expect(await page.getByText("Create bead…", { exact: true }).count()).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const sibling = await context.newPage();
  await sibling.goto(`${base}/p/demo`);
  await sibling.getByRole("button", { name: "Read Only Mode", exact: true }).waitFor();
  await banner.click();
  const changed = page.waitForResponse(
    (r) => r.url().endsWith("/api/viewer-mode") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Disable read-only mode", exact: true }).click();
  expect((await changed).status()).toBe(200);
  await page
    .getByRole("dialog", { name: "Read Only Mode", exact: true })
    .waitFor({ state: "detached" });
  await banner.waitFor({ state: "detached" });
  await sibling
    .getByRole("button", { name: "Read Only Mode", exact: true })
    .waitFor({ state: "detached" });
  const cookie = required((await context.cookies()).find((c) => c.name === "scotty-viewer-mode"));
  expect(cookie.expires, "Editing preference must use a session cookie").toBe(-1);
  expect((await write(context)).status()).toBe(201);
  expect((await write(other)).status(), "Other browser sessions must remain read-only").toBe(403);
  await page.reload();
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  await page.locator("article").first().click();
  const draft = page.getByPlaceholder(/^Comment as/);
  await draft.fill("Keep this draft if saving fails");
  await page.route("**/comments", (r) =>
    r.fulfill({ status: 403, json: { error: "Read-only mode", code: "read_only" } }),
  );
  const rejected = page.waitForResponse((r) => r.url().endsWith("/comments"));
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await rejected;
  expect(await draft.inputValue()).toBe("Keep this draft if saving fails");
  await page.unroute("**/comments");
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/comments", async (route) => {
    await saveGate;
    await route.continue();
  });
  await draft.fill("First message");
  const saving = page.waitForRequest((r) => r.url().endsWith("/comments"));
  const saved = page.waitForResponse((r) => r.url().endsWith("/comments"));
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await saving;
  await draft.fill("Newer text must stay");
  releaseSave();
  expect((await saved).status()).toBe(200);
  await page.waitForFunction(() => {
    const input = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder^="Comment as"]',
    );
    const button = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Comment",
    );
    return input?.value === "" || !button?.disabled;
  });
  expect(await draft.inputValue(), "Save must not erase newer typing").toBe("Newer text must stay");
  const status = page.getByRole("dialog").locator("select").first();
  const originalStatus = await status.inputValue();
  await status.selectOption("closed");
  await sibling.getByRole("button", { name: "Settings", exact: true }).click();
  await sibling.getByRole("button", { name: "Enable read-only mode", exact: true }).click();
  await page.getByText("Close reason — optional", { exact: true }).waitFor({ state: "detached" });
  expect(
    await status.inputValue(),
    "Read-only must show the saved status, not an unconfirmed close",
  ).toBe(originalStatus);
  await page.getByTitle("Close", { exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await banner.waitFor();
  await sibling.getByRole("button", { name: "Read Only Mode", exact: true }).waitFor();
  expect((await write(context)).status()).toBe(403);
  expect(errors).toStrictEqual([]);
  console.log(
    "PASS: banner preferences, disabled editors, session-only unlock, reload, and re-enable",
  );
});
