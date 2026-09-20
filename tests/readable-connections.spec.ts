import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

const dep = (depends_on_id: string, type = "blocks") => ({ depends_on_id, type });
for (const width of [390, 1440]) {
  test(`epic titles and dependency arrows at ${width}px`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height: 940 } });
    const page = await context.newPage();
    const beads = [
      makeBead("prerequisite", { title: "Approve study" }),
      makeBead("epic", {
        issue_type: "epic",
        title: "Publish study",
        dependencies: [dep("prerequisite")],
      }),
      makeBead("child", {
        title: "Validate data",
        dependencies: [dep("epic", "parent-child"), dep("prerequisite")],
      }),
      makeBead("done", {
        title: "Completed check",
        status: "closed",
        dependencies: [dep("epic", "parent-child"), dep("child")],
      }),
      makeBead("next", {
        issue_type: "epic",
        title: "Release",
        dependencies: [dep("epic", "waits-for")],
      }),
    ];
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
      if (path === "/api/viewer-mode") return route.fulfill({ json: { readOnly: true } });
      if (path.endsWith("/beads"))
        return route.fulfill({
          json: { beads, meta: { kind: "demo", humanAllowlist: [], pollIntervalMs: 300000 } },
        });
      if (/\/beads\/[^/]+$/.test(path))
        return route.fulfill({ json: beads.find((b) => path.endsWith("/" + b.id)) ?? {} });
      return route.continue();
    });
    await page.goto(`${baseURL}/p/demo?view=graph`);
    const toggle = () =>
      page.getByRole("button", { name: /^(Expand|Collapse) epic Publish study$/ });
    const edge = (source: string, target: string) =>
      page.locator(`[data-readable-edge][data-source="${source}"][data-target="${target}"]`);
    await expect(edge("prerequisite", "epic")).toHaveCount(1);
    await expect(edge("epic", "next")).toHaveCount(1);
    await expect(edge("prerequisite", "child")).toHaveCount(0);
    await page.getByRole("button", { name: "Open epic Publish study", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByTitle("Close", { exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await toggle().focus();
    await expect(toggle()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle()).toHaveAttribute("aria-expanded", "true");
    await expect(edge("prerequisite", "child")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Epic details", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Epic dependencies", exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-readable-edge][data-source="epic"][data-target="child"]'),
    ).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Hide completed", exact: true }).uncheck();
    await expect(edge("child", "done")).toHaveCount(1);
    await expect
      .poll(() =>
        page.locator("[data-readable-connections]").evaluate((root) => {
          const boxes = [...root.querySelectorAll("[data-connection-node]")].map((n) =>
            n.getBoundingClientRect(),
          );
          const origin = root.getBoundingClientRect();
          for (const path of root.querySelectorAll<SVGPathElement>("[data-readable-edge]")) {
            for (let length = 2; length < path.getTotalLength() - 2; length += 2) {
              const p = path.getPointAtLength(length),
                x = p.x + origin.x,
                y = p.y + origin.y;
              if (
                boxes.some(
                  (b) => x > b.left + 1 && x < b.right - 1 && y > b.top + 1 && y < b.bottom - 1,
                )
              )
                return false;
            }
          }
          return true;
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`epic-connections-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    await toggle().click({ position: { x: 8, y: 8 } });
    await expect(edge("prerequisite", "child")).toHaveCount(0);
    await expect(edge("prerequisite", "epic")).toHaveCount(1);
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 940 });
    await expect(edge("prerequisite", "epic")).toHaveCount(1);
    await page.getByLabel("Graph scope", { exact: true }).selectOption("epic");
    await expect(edge("prerequisite", "child")).toHaveCount(1);
    await expect(edge("epic", "next")).toHaveCount(1);
    await expect
      .poll(() =>
        page.locator("[data-readable-connections]").evaluate((root) => {
          const origin = root.getBoundingClientRect();
          const nodes = [...root.querySelectorAll<HTMLElement>("[data-connection-node]")];
          const down = (root as HTMLElement).dataset.direction === "down";
          const targets = new Map(
            nodes.map((node) => {
              const port =
                down && node.parentElement?.hasAttribute("data-readable-epic")
                  ? node.parentElement
                  : node;
              const rect = port.getBoundingClientRect();
              return [
                node.dataset.connectionNode,
                {
                  x: rect.x + (down ? rect.width / 2 : 0),
                  y: rect.y + (down ? 0 : rect.height / 2),
                },
              ];
            }),
          );
          return [...root.querySelectorAll<SVGPathElement>("[data-readable-edge]")].every(
            (path) => {
              const target = targets.get(path.dataset.target);
              if (!target) return false;
              const end = path.getPointAtLength(path.getTotalLength());
              return (
                Math.abs(end.x + origin.x - target.x) < 1 &&
                Math.abs(end.y + origin.y - target.y) < 1
              );
            },
          );
        }),
      )
      .toBe(true);
    expect(errors).toStrictEqual([]);
    expect(writes).toStrictEqual([]);
  });
}
