import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("telemetry ui", async ({ browser, baseURL }, testInfo) => {
  const base = required(baseURL);
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const settings = await (await fetch(`${base}/api/telemetry`)).json();
  expect(settings.configured, "UI test must not send production events").toBe(false);
  expect(
    (
      await fetch(`${base}/api/telemetry`, {
        method: "PUT",
        headers: { origin: base, "content-type": "application/json" },
        body: '{"enabled":true}',
      })
    ).status,
  ).toBe(200);

  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/p/demo?view=settings`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Share basic usage statistics" });
  await toggle.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-labelledby="usage-label"]')?.textContent === "Enabled",
  );
  await toggle.click();
  await page.waitForFunction(
    () => document.querySelector('[aria-labelledby="usage-label"]')?.textContent === "Disabled",
  );
  await page.reload();
  await toggle.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-labelledby="usage-label"]')?.textContent === "Disabled",
  );
  expect(await toggle.getAttribute("aria-checked")).toBe("false");
  const other = await browser.newPage();
  await other.goto(`${base}/p/demo?view=settings`);
  await other.getByRole("button", { name: "Settings", exact: true }).click();
  await other.waitForFunction(
    () => document.querySelector('[aria-labelledby="usage-label"]')?.textContent === "Disabled",
  );
  await page.route("**/api/telemetry", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, body: "{}" })
      : route.continue(),
  );
  await toggle.click();
  await page.getByText("Could not save usage preference. Please try again.").waitFor();
  expect(await toggle.getAttribute("aria-checked")).toBe("false");
  await page.unroute("**/api/telemetry");
  await toggle.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("scotty-usage-settings.png") });
  expect(
    (
      await fetch(`${base}/api/telemetry`, {
        method: "PUT",
        headers: { origin: "https://foreign.example", "content-type": "application/json" },
        body: '{"enabled":true}',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${base}/api/telemetry`, {
        method: "PUT",
        headers: { origin: base, "content-type": "application/json" },
        body: '{"enabled":"true"}',
      })
    ).status,
  ).toBe(400);
  expect(errors).toStrictEqual([]);
  console.log(
    "PASS: Settings toggle in read-only mode, reload, shared browser preference, save failure, invalid input and foreign-origin rejection",
  );
});
