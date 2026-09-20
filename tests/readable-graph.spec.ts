import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

const dep = (depends_on_id: string, type = "parent-child") => ({ depends_on_id, type });
function fixtures() {
  return [
    makeBead("rollout", { issue_type: "epic", title: "Study rollout" }),
    makeBead("prepare", {
      issue_type: "epic",
      title: "Data preparation",
      dependencies: [dep("rollout")],
    }),
    makeBead("validation", {
      issue_type: "epic",
      title: "Validation",
      dependencies: [dep("rollout")],
    }),
    makeBead("prepared", {
      title: "Publish study artifacts",
      status: "closed",
      dependencies: [dep("prepare")],
    }),
    makeBead("prepare-open", { title: "Freeze staging snapshot", dependencies: [dep("prepare")] }),
    makeBead("work", {
      title: "Run validation checks",
      dependencies: [
        dep("validation"),
        dep("prepared", "blocks"),
        dep("missing", "waits-for"),
        dep("archived", "conditional-blocks"),
        dep("reference", "related"),
      ],
    }),
    makeBead("review", {
      title:
        "Review the validation report with a long title that remains readable on a narrow phone without zooming or truncating its contents",
      dependencies: [dep("validation"), dep("work", "blocks")],
    }),
    makeBead("reference", { title: "External study documentation" }),
    makeBead("archived", { title: "Secret archived title", labels: ["archived"] }),
    makeBead("unrelated", { title: "Unrelated work" }),
  ];
}

for (const width of [390, 1440]) {
  test(`readable epic navigation and task focus at ${width}px`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width, height: 940 },
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    const page = await context.newPage();
    const beads = fixtures();
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === "/api/telemetry")
        return route.fulfill({ json: { configured: false, enabled: false, ok: true } });
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
    await expect(page.locator("[data-readable-graph]")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Expand epic Study rollout", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-readable-task="work"]')).toHaveCount(0);
    await page.getByLabel("Graph scope", { exact: true }).selectOption("rollout");
    await expect(
      page.getByRole("button", { name: "Collapse epic Study rollout", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Expand epic Data preparation", exact: true })
      .click({ position: { x: 8, y: 8 } });
    await page
      .getByRole("button", { name: "Expand epic Validation", exact: true })
      .click({ position: { x: 8, y: 8 } });
    await expect(
      page.getByRole("button", {
        name: `${width < 768 ? "Expand" : "Collapse"} epic Data preparation`,
        exact: true,
      }),
    ).toBeVisible();
    const work = page.locator('[data-readable-task="work"]');
    await expect(work).toBeVisible();
    await expect(page.locator('[data-readable-task="prepared"]')).toHaveCount(0);
    const typography = await work
      .getByRole("button", { name: "Open task Run validation checks", exact: true })
      .evaluate((e) => ({
        size: parseFloat(getComputedStyle(e).fontSize),
        width: e.getBoundingClientRect().width,
      }));
    expect(typography.size).toBeGreaterThanOrEqual(14);
    expect(typography.width).toBeGreaterThan(180);
    expect(
      await page.locator(".readable-graph-scroll").evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    const focusButton = work.getByRole("button", {
      name: "Focus dependencies for Run validation checks",
      exact: true,
    });
    await focusButton.scrollIntoViewIfNeeded();
    // Browser click/keyboard activation can scroll a control into view. Capture
    // the position at activation, which is what Back should restore.
    await focusButton.evaluate((button) => {
      button.addEventListener(
        "click",
        () => {
          document.documentElement.dataset.overviewScroll = String(
            document.querySelector(".readable-graph-scroll")?.scrollTop,
          );
        },
        { capture: true, once: true },
      );
    });
    await page.screenshot({ path: testInfo.outputPath(`readable-epic-${width}.png`) });
    await work
      .getByRole("button", { name: "Focus dependencies for Run validation checks", exact: true })
      .click();
    const overviewScroll = Number(await page.locator("html").getAttribute("data-overview-scroll"));
    await expect(
      page.getByRole("region", { name: "Task neighborhood", exact: true }),
    ).toBeVisible();
    const up = page.getByRole("region", { name: "Prerequisites", exact: true });
    await expect(up.locator('[data-readable-task="prepared"]')).toBeVisible();
    await expect(
      up.getByText("Unavailable task (missing or archived)", { exact: true }),
    ).toHaveCount(2);
    await expect(page.getByText("Secret archived title", { exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "Dependents", exact: true })
        .locator('[data-readable-task="review"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Other relationships", exact: true }),
    ).toContainText("External study documentation");
    const geometry = await page
      .locator(".task-neighborhood-grid > section")
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
    expect(geometry[0].bottom).toBeLessThanOrEqual(geometry[1].top);
    expect(
      await page.locator(".readable-graph-scroll").evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "View task details", exact: true }).click();
    await expect(page.getByRole("dialog").locator("select").first()).toBeDisabled();
    await page.getByTitle("Close", { exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.screenshot({ path: testInfo.outputPath(`task-focus-${width}.png`) });
    await page.getByRole("button", { name: "Back to epic view" }).click();
    await expect
      .poll(() => page.locator(".readable-graph-scroll").evaluate((e) => e.scrollTop))
      .toBeCloseTo(overviewScroll, 0);
    await expect(
      page.getByRole("button", { name: "Collapse epic Validation", exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Hide completed", exact: true }).uncheck();
    await page
      .getByRole("button", {
        name: `${width < 768 ? "Expand" : "Collapse"} epic Data preparation`,
        exact: true,
      })
      .click({ position: { x: 8, y: 8 } });
    if (width >= 768)
      await page
        .getByRole("button", { name: "Expand epic Data preparation", exact: true })
        .click({ position: { x: 8, y: 8 } });
    await expect(page.locator('[data-readable-task="prepared"]')).toBeVisible();
    await expect(page.getByLabel("Graph scope", { exact: true })).toHaveValue("rollout");
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Hide completed", exact: true }),
    ).not.toBeChecked();
    await page
      .getByRole("button", { name: "Expand epic Study rollout", exact: true })
      .click({ position: { x: 8, y: 8 } });
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Expand epic Study rollout", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    const overflow = await page.evaluate(() => document.body.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    expect(errors).toStrictEqual([]);
    expect(writes).toStrictEqual([]);
  });
}
