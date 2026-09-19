import { expect, test } from "./fixtures";

test("theme hydration", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const page = await browser.newPage();
  const errors: string[] = [];
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
  expect(errors, "saved dark theme must hydrate without console errors").toStrictEqual([]);
  await page.getByTitle("Toggle theme", { exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.reload();
  await page.getByTitle("Toggle theme", { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  expect(await page.evaluate(() => localStorage.getItem("bmus.theme.demo"))).toBe("light");
  expect(errors).toStrictEqual([]);
  console.log("PASS: saved dark theme hydration, reload, toggle, and persistence");
});
