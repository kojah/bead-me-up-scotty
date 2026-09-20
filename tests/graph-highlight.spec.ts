import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

for (const touch of [false, true]) {
  test(`path previews and pins stay separate with ${touch ? "touch" : "mouse"}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width: touch ? 390 : 1440, height: 1000 },
      hasTouch: touch,
    });
    const page = await context.newPage();
    const parent = (id: string) => ({ depends_on_id: id, type: "parent-child" });
    const beads = [
      makeBead("epic", { issue_type: "epic", title: "Release" }),
      makeBead("nested", { issue_type: "epic", title: "Nested", dependencies: [parent("epic")] }),
      makeBead("a", { title: "Prepare", dependencies: [parent("nested")] }),
      makeBead("b", { title: "Independent", dependencies: [parent("nested")] }),
      makeBead("c", {
        title: "Publish",
        dependencies: [parent("nested"), { depends_on_id: "a", type: "blocks" }],
      }),
    ];
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === "/api/telemetry") return route.fulfill({ json: { configured: false } });
      if (req.method() !== "GET") {
        writes.push(path);
        return route.abort();
      }
      if (path.endsWith("/beads/stream")) return route.abort();
      if (path.endsWith("/beads"))
        return route.fulfill({ json: { beads, meta: { kind: "demo", pollIntervalMs: 300000 } } });
      return route.continue();
    });
    await page.goto(`${baseURL}/p/demo?view=graph`);
    const activate = async (name: string) => {
      const button = page.getByRole("button", { name, exact: true });
      if (touch) await button.tap({ position: { x: 8, y: 8 } });
      else await button.click({ position: { x: 8, y: 8 } });
    };
    await activate("Expand epic Release");
    await activate("Expand epic Nested");
    const card = (id: string) => page.locator(`[data-readable-task="${id}"]`);
    const allBright = async () => {
      for (const id of ["a", "b", "c"]) await expect(card(id)).toHaveCSS("opacity", "1");
    };
    await page.mouse.move(0, 0);
    await allBright();
    await expect(page.getByRole("button", { name: "Clear path", exact: true })).toBeDisabled();
    if (!touch) {
      await card("a").hover();
      await expect(card("b")).toHaveCSS("opacity", "0.3");
      await expect(card("c")).toHaveCSS("opacity", "1");
      await card("a")
        .getByRole("button", { name: "Focus dependencies for Prepare", exact: true })
        .hover();
      await expect(card("b")).toHaveCSS("opacity", "0.3");
      await page.mouse.move(0, 0);
      await allBright();
      // A mouse click on card whitespace must not leave focus highlighting behind.
      await card("a").click({ position: { x: 8, y: 8 } });
      await page.mouse.move(0, 0);
      await allBright();
      await card("a")
        .getByRole("button", { name: "Focus dependencies for Prepare", exact: true })
        .focus();
      await page.keyboard.press("Shift+Tab");
      await expect(
        card("a").getByRole("button", { name: "Open task Prepare", exact: true }),
      ).toBeFocused();
      await expect(card("b")).toHaveCSS("opacity", "0.3");
      await page.keyboard.press("Tab");
      await expect(card("b")).toHaveCSS("opacity", "0.3");
      await page.keyboard.press("Escape");
      await allBright();
    } else {
      await card("a").tap({ position: { x: 8, y: 8 } });
      await allBright();
    }
    const pin = page.getByRole("button", { name: "Highlight path for Prepare", exact: true });
    await activate("Highlight path for Prepare");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await card("b").hover();
    await expect(card("b")).toHaveCSS("opacity", "0.3");
    await activate("Highlight path for Prepare");
    await page.mouse.move(0, 0);
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await allBright();
    await activate("Highlight path for Prepare");
    await activate("Collapse epic Nested");
    await activate("Expand epic Nested");
    await page.mouse.move(0, 0);
    await allBright();
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
    await context.close();
  });
}
