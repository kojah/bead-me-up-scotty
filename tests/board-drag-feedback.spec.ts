import { beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("board drag feedback", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const bead = (id: string, status: string) =>
    beadSchema.parse({
      id,
      title: `Feedback ${id}`,
      status,
      issue_type: "task",
      priority: 2,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    });

  const beads = [
    bead("mover", "open"),
    bead("ready-peer", "open"),
    // A long source column: its lower cards sit level with the pointer when dropping low in a shorter column.
    ...Array.from({ length: 8 }, (_, i) => bead(`filler-${i + 1}`, "open")),
    bead("busy-a", "in_progress"),
    bead("busy-b", "in_progress"),
  ];
  const writes: { kind: string; id?: string; body: Record<string, unknown> }[] = [];

  let page!: import("@playwright/test").Page;
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(9000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.route("**/api/p/demo/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/beads/stream")) return route.abort();
      if (path.endsWith("/order")) return respondToOrder();
      function respondToOrder() {
        if (request.method() === "GET") return route.fulfill({ json: { orders: {} } });
        writes.push({ kind: "order", body: request.postDataJSON() });
        return route.fulfill({ json: { orders: {} } });
      }
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
      if (path.endsWith("/status")) {
        const body = request.postDataJSON();
        const id = path.split("/").at(-2);
        const target = required(beads.find((candidate) => candidate.id === id));
        if (target) target.status = body.status;
        writes.push({ kind: "status", id, body });
        return route.fulfill({ json: target ?? {} });
      }
      return route.fulfill({
        json: beads.find((candidate) => path.endsWith(`/beads/${candidate.id}`)) ?? {},
      });
    });

    const card = (id: string) => page.locator(`[data-keyboard-bead-id="${id}"]`);
    const column = (name: string) =>
      page.getByText(name, { exact: true }).locator("xpath=ancestor::section[1]");
    // The drop zone is the element that holds a column's cards.
    const zoneHighlighted = (name: string) =>
      column(name)
        .locator("article")
        .first()
        .locator("xpath=..")
        .evaluate((zone) => getComputedStyle(zone).outlineStyle === "dashed");
    const center = async (locator: import("@playwright/test").Locator) => {
      const box = required(await locator.boundingBox());
      expect(box, "drag targets must be visible").toBeTruthy();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const pickUp = async (id: string) => {
      const from = await center(card(id));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
    };
    const hoverCard = async (id: string) => {
      const to = await center(card(id));
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.waitForTimeout(150);
      return to;
    };
    const previewUnderPointer = (point: { x: number; y: number }, title: string) =>
      page.evaluate(
        ({ x, y, text }) =>
          document
            .elementsFromPoint(x, y)
            .some((element) => element.closest("article")?.textContent?.includes(text)),
        { ...point, text: title },
      );

    await page.goto(`${base}/p/demo`);
    await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
    const unlock = await context.request.put(`${base}/api/viewer-mode`, {
      data: { readOnly: false },
    });
    expect(unlock.status(), "isolated demo can be unlocked for mutation assertions").toBe(200);
    await page.reload();
    await card("mover").waitFor();

    // Hovering a card in another column is the common case: the preview must travel with the pointer
    // and the column under it must advertise itself as the drop target.
    await pickUp("mover");
    const overBusy = await hoverCard("busy-a");
    expect(
      await page.locator('article[aria-hidden="true"] button').count(),
      "the preview has no hidden focusable copy button",
    ).toBe(0);
    expect(
      await previewUnderPointer(overBusy, "Feedback mover"),
      "a preview of the dragged card follows the pointer into another column",
    ).toBeTruthy();
    expect(
      await zoneHighlighted("In Progress"),
      "the column under the pointer is highlighted while hovering one of its cards",
    ).toBe(true);
    expect(
      await zoneHighlighted("Ready"),
      "the source column is not highlighted as a drop target",
    ).toBe(false);

    const statusWrite = page.waitForResponse(
      (response) =>
        response.url().endsWith("/beads/mover/status") && response.request().method() === "POST",
    );
    await page.mouse.up();
    await statusWrite;
    expect(
      writes.map((write) => write.kind),
      "dropping on another column's card writes status only",
    ).toStrictEqual(["status"]);
    expect(required(writes.at(-1)).body.status).toBe("in_progress");
    await card("mover")
      .locator("xpath=ancestor::section[1]")
      .getByText("In Progress", { exact: true })
      .waitFor();
    expect(await zoneHighlighted("In Progress"), "the highlight clears after a drop").toBe(false);

    // Escape cancels a drag without writing, and clears both the preview and the highlight.
    const cancelWrites = writes.length;
    await pickUp("ready-peer");
    const overPeer = await hoverCard("busy-b");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(writes.length, "a cancelled drag writes nothing").toBe(cancelWrites);
    expect(
      await previewUnderPointer(overPeer, "Feedback ready-peer"),
      "the preview is removed when a drag is cancelled",
    ).toBe(false);
    expect(
      await zoneHighlighted("In Progress"),
      "the highlight clears when a drag is cancelled",
    ).toBe(false);

    // The column under the pointer is the target, even in its empty space and even when a long source
    // column has cards closer to the dragged card's corners.
    const emptySpaceWrites = writes.length;
    await pickUp("ready-peer");
    const zone = required(
      await column("In Progress").locator("article").first().locator("xpath=..").boundingBox(),
    );
    await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height - 30, { steps: 12 });
    await page.waitForTimeout(150);
    expect(
      await zoneHighlighted("In Progress"),
      "empty space low in another column is highlighted as the drop target",
    ).toBe(true);
    const emptySpaceStatus = page.waitForResponse(
      (response) =>
        response.url().endsWith("/beads/ready-peer/status") &&
        response.request().method() === "POST",
    );
    await page.mouse.up();
    await emptySpaceStatus;
    expect(
      writes.slice(emptySpaceWrites).map((write) => write.kind),
      "dropping into another column's empty space writes status only",
    ).toStrictEqual(["status"]);
    expect(required(writes.at(-1)).body.status).toBe("in_progress");

    // Dependency-blocked open beads cannot become Ready through a no-op status write.
    beads.push({
      ...bead("blocked-open", "open"),
      dependencies: [{ depends_on_id: "filler-1", type: "blocks" }],
    });
    await page.reload();
    await card("blocked-open").waitFor();
    const blockedWrites = writes.length;
    await pickUp("blocked-open");
    await hoverCard("filler-1");
    expect(
      await zoneHighlighted("Ready"),
      "a no-op status destination must not advertise a move",
    ).toBe(false);
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(
      writes.length,
      "a dependency-blocked bead cannot be unblocked by setting open again",
    ).toBe(blockedWrites);

    expect(errors).toStrictEqual([]);
    console.log(
      "PASS: cross-column drag shows a travelling preview and target highlight, still writes status on drop, and cancels cleanly",
    );
  } catch (error) {
    console.error({ writes, url: page?.url() });
    throw error;
  }
});
