import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
for (const width of [390, 1440])
  test(`readable flow refinement at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: width < 768,
    });
    const page = await context.newPage();
    const beads = [
      makeBead("epic", { issue_type: "epic", title: "Release" }),
      makeBead("a", { title: "Prepare", dependencies: [dep("epic", "parent-child")] }),
      makeBead("b", { title: "Configure", dependencies: [dep("epic", "parent-child")] }),
      makeBead("merge", {
        title: "Build",
        dependencies: [dep("epic", "parent-child"), dep("a"), dep("b")],
      }),
      makeBead("next", {
        title: "Validate",
        dependencies: [dep("epic", "parent-child"), dep("merge")],
      }),
    ];
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === "/api/telemetry")
        return route.fulfill({ json: { configured: false, enabled: false } });
      if (req.method() !== "GET") {
        writes.push(path);
        return route.abort();
      }
      if (path.endsWith("/beads/stream")) return route.abort();
      if (path.endsWith("/beads"))
        return route.fulfill({
          json: { beads, meta: { kind: "demo", humanAllowlist: [], pollIntervalMs: 300000 } },
        });
      return route.continue();
    });
    await page.goto(`${baseURL}/p/demo?view=graph`);
    const root = page.locator("[data-readable-connections]");
    await expect(root).toHaveAttribute("data-direction", "down");
    await page
      .getByRole("button", { name: "Expand epic Release", exact: true })
      .click({ position: { x: 8, y: 8 } });
    await expect(page.locator("[data-readable-edge]")).toHaveCount(3);
    const card = (id: string) => page.locator(`[data-readable-task="${id}"]`);
    await expect
      .poll(() =>
        page
          .locator("[data-readable-edge]")
          .evaluateAll((nodes) => nodes.some((n) => n.getAttribute("d")?.includes("Q"))),
      )
      .toBe(true);
    await card("a").hover();
    await expect(card("b")).toHaveCSS("opacity", "0.3");
    await expect(page.locator('[data-readable-edge][data-source="b"]')).toHaveAttribute(
      "data-highlighted",
      "false",
    );
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await card("b").getByRole("button", { name: "Open task Configure", exact: true }).focus();
    await expect(card("a")).toHaveCSS("opacity", "0.3");
    const pin = card("a").getByRole("button", { name: "Highlight path for Prepare", exact: true });
    if (width < 768) await pin.tap();
    else await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await card("b").hover();
    await expect(card("b")).toHaveCSS("opacity", "0.3");
    await page.getByRole("button", { name: "Clear path", exact: true }).click();
    await expect(card("b")).toHaveCSS("opacity", "1");
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    const before = await card("merge").boundingBox(),
      after = await card("next").boundingBox();
    expect(Math.abs(before!.x + before!.width / 2 - after!.x - after!.width / 2)).toBeLessThan(1);
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`refined-down-${width}.png`) });
    await page.getByLabel("Graph direction", { exact: true }).selectOption("right");
    await expect(root).toHaveAttribute("data-direction", "right");
    await expect
      .poll(async () => {
        const a = await card("a").boundingBox(),
          merge = await card("merge").boundingBox(),
          next = await card("next").boundingBox();
        return merge!.x > a!.x + a!.width && next!.x > merge!.x + merge!.width;
      })
      .toBe(true);
    if (width < 768)
      expect(
        await page.locator(".readable-graph-scroll").evaluate((e) => e.scrollWidth > e.clientWidth),
      ).toBe(true);
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`refined-right-${width}.png`) });
    expect(errors).toStrictEqual([]);
    expect(writes).toStrictEqual([]);
  });
