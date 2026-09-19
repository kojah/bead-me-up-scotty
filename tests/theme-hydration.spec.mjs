import assert from "node:assert/strict";
import { test } from "./fixtures.mjs";

test("theme hydration", async ({ browser, baseURL }) => {
  const base = baseURL;
  assert.ok(base, "Playwright baseURL must be configured");

  const page = await browser.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("theme-test-seeded")) {
      localStorage.setItem("bmus.theme.demo", "dark");
      localStorage.setItem("theme-test-seeded", "true");
    }
  });
  await page.goto(`${base}/p/demo?view=epics`);
  await page.getByTitle("Toggle theme", { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.reload();
  await page.getByTitle("Toggle theme", { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.deepEqual(errors, [], "saved dark theme must hydrate without console errors");
  await page.getByTitle("Toggle theme", { exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.reload();
  await page.getByTitle("Toggle theme", { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  assert.equal(await page.evaluate(() => localStorage.getItem("bmus.theme.demo")), "light");
  assert.deepEqual(errors, []);
  console.log("PASS: saved dark theme hydration, reload, toggle, and persistence");
});
