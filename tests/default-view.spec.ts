import { expect, test } from "./fixtures";

test("default view", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const nav = (name: string) => page.getByRole("button", { name, exact: true }).click();
  const heading = (name: string) => page.getByRole("heading", { name, exact: true }).waitFor();
  const project = async (name: string) => {
    await page.goto(`${base}/p/demo`);
    await heading(name);
  };
  const toggle = page.getByRole("switch", { name: "Use Focus as the default view" });
  await project("Board");
  await page.evaluate(() => localStorage.setItem("bmus.view.demo", "focus"));
  await project("Board"); // Old remembered-view storage is still ignored.
  await nav("Settings");
  expect(await toggle.getAttribute("aria-checked")).toBe("false");
  await toggle.click();
  expect(await toggle.getAttribute("aria-checked")).toBe("true");
  await page.reload();
  await heading("Settings"); // Explicit URLs override the default, including reload.
  await project("Focus");
  await nav("List");
  await page.reload();
  await heading("List");
  await project("Focus");
  await nav("Settings");
  expect(await toggle.getAttribute("aria-checked")).toBe("true");
  await toggle.click();
  await project("Board");
  await nav("Focus");
  await page.reload();
  await heading("Focus");
  await project("Board"); // Visiting Focus does not opt into a different default.
  await nav("Settings");
  expect(await toggle.getAttribute("aria-checked")).toBe("false");
  await toggle.click();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`${base}/p/demo`);
  await otherPage.getByRole("button", { name: "Settings", exact: true }).click();
  expect(
    await otherPage
      .getByRole("switch", { name: "Use Focus as the default view" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  console.log(
    "PASS: Board default, explicit Focus opt-in, explicit view URLs and reloads, ignored legacy view preference, browser isolation",
  );
});
