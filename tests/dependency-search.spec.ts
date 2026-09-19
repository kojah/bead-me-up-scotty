import { type Bead, beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("dependency search", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const bead = (id: string, title: string = id, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title,
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });
  const dep = (type: string, depends_on_id: string) => ({ type, depends_on_id });
  const beads = [
    bead("current", "Current dependency host", {
      dependencies: [dep("blocks", "linked"), dep("parent-child", "parent")],
    }),
    bead("linked", "Already linked target"),
    bead("parent", "Hierarchy target"),
    bead("a-2", "Second candidate"),
    bead("a-10", "Tenth candidate"),
    bead("a-1", "First candidate"),
    bead("exact-id", "Another candidate"),
    bead("title-match", "contains EXACT-ID in its title"),
    bead("closed-free", "Closed but eligible", { status: "closed" }),
    ...Array.from({ length: 62 }, (_, i) =>
      bead(
        `bulk-${String(i).padStart(2, "0")}`,
        `Untruncated candidate ${i}: this deliberately exceeds forty characters`,
      ),
    ),
  ];
  const writes: { path: string; method?: string; body: Record<string, unknown> }[] = [];
  let failOnce = true;
  let releasePending!: () => void;
  let pendingResolve!: () => void;
  const pending = new Promise<void>((resolve) => {
    pendingResolve = resolve;
  });

  let page!: import("@playwright/test").Page;
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.route("**/api/p/demo/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/beads/stream")) return route.abort();
      if (request.method() === "GET") {
        if (path.endsWith("/beads"))
          return route.fulfill({
            json: {
              beads,
              meta: {
                kind: "demo",
                humanActor: "reviewer",
                humanAllowlist: ["reviewer"],
                pollIntervalMs: 300_000,
              },
            },
          });
        return route.fulfill({ json: beads.find((b) => path.endsWith(`/beads/${b.id}`)) ?? {} });
      }
      const body = request.postDataJSON();
      writes.push({ method: request.method(), path, body });
      if (body.depends_on_id === "exact-id" && failOnce) {
        failOnce = false;
        return route.fulfill({ status: 500, json: { error: "temporary dependency failure" } });
      }
      if (body.depends_on_id === "bulk-00") {
        pendingResolve();
        await new Promise<void>((resolve) => {
          releasePending = resolve;
        });
      }
      const source = required(beads.find((b) => path.endsWith(`/beads/${b.id}/deps`)));
      source.dependencies.push(dep(body.type, body.depends_on_id));
      return route.fulfill({ json: source });
    });

    await page.goto(`${base}/p/demo`);
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
    await page.getByText("Current dependency host", { exact: true }).first().click();
    const drawer = page.getByRole("dialog");
    const addDependency = () => drawer.getByRole("button", { name: "Add dependency", exact: true });
    const search = () =>
      drawer.getByRole("combobox", { name: "Search dependency beads", exact: true });
    const add = () => drawer.getByRole("button", { name: "Add", exact: true });
    const cancel = () => drawer.getByRole("button", { name: "Cancel dependency", exact: true });
    const options = () => drawer.getByRole("listbox").getByRole("option");
    const comment = drawer.getByPlaceholder(/^Comment as/);
    await comment.fill("Preserve this comment through dependency writes.");

    await addDependency().click();
    await search().waitFor();
    expect(await search().getAttribute("placeholder")).toBe("Search by ID or title…");
    expect(
      await options().filter({ hasText: "Current dependency host" }).count(),
      "current bead is never a candidate",
    ).toBe(0);
    expect(
      await options().filter({ hasText: "Already linked target" }).count(),
      "existing outgoing link is excluded",
    ).toBe(0);
    expect(
      await options().filter({ hasText: "Hierarchy target" }).count(),
      "existing parent-child link is excluded",
    ).toBe(0);
    expect(
      await options().filter({ hasText: "Closed but eligible" }).count(),
      "closed but unlinked beads stay eligible",
    ).toBe(1);
    expect(await options().count(), "the picker does not quietly cap candidates").toBe(68);
    const initialIds = await options().evaluateAll((els) =>
      els.slice(0, 3).map((el) => el.getAttribute("data-value")),
    );
    expect(initialIds, "default candidates use natural ID order").toStrictEqual([
      "a-1",
      "a-2",
      "a-10",
    ]);
    expect(
      await options().filter({ hasText: "Untruncated candidate 61" }).innerText(),
      "full titles are rendered without truncation",
    ).toMatch(/this deliberately exceeds forty characters/);
    await search().fill("no-such-dependency");
    await drawer.getByText("No matching beads.", { exact: true }).waitFor();
    expect(await options().count(), "unmatched queries show an empty list").toBe(0);
    expect(await add().isDisabled(), "empty results cannot be submitted").toBe(true);

    // Keyboard movement changes cmdk's highlighted item; Enter selects it without submitting a write.
    await search().fill("a-");
    const highlighted = () => drawer.locator('[cmdk-item][data-selected="true"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector<HTMLButtonElement>('[cmdk-item][data-selected="true"]')
          ?.getAttribute("data-value") === "a-1",
    );
    await search().press("ArrowDown");
    expect(
      await highlighted().getAttribute("data-value"),
      "ArrowDown moves to the next candidate",
    ).toBe("a-2");
    await search().press("ArrowUp");
    expect(
      await highlighted().getAttribute("data-value"),
      "ArrowUp moves back to the first candidate",
    ).toBe("a-1");
    await search().press("Enter");
    await drawer.getByRole("button", { name: "Clear selected bead", exact: true }).waitFor();
    expect(await drawer.getByText("First candidate", { exact: true }).innerText()).toMatch(
      /First candidate/,
    );
    expect(writes.length, "keyboard selection does not write").toBe(0);
    await drawer.getByRole("button", { name: "Clear selected bead", exact: true }).click();
    await search().waitFor();
    expect(
      await search().inputValue(),
      "clearing selection restores an empty searchable list",
    ).toBe("");
    expect(await options().count(), "clearing restores every eligible candidate").toBe(68);

    await search().fill("EXACT-id");
    await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 2);
    const matchIds = await options().evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-value")),
    );
    expect(
      matchIds,
      "case-insensitive matches prioritize exact ID before title matches",
    ).toStrictEqual(["exact-id", "title-match"]);
    await search().press("Enter");
    await drawer.getByRole("button", { name: "Clear selected bead", exact: true }).waitFor();
    expect(writes.length, "Enter chooses the highlighted bead and does not write").toBe(0);
    const type = drawer.getByLabel("Dependency type", { exact: true });
    expect(await type.inputValue()).toBe("blocks");
    expect(await type.locator('option[value="blocks"]').innerText()).toBe("blocked by");
    expect(await type.locator('option[value="related"]').innerText()).toBe("related");
    await type.selectOption("related");
    await add().click();
    await page.getByText(/temporary dependency failure/i).waitFor();
    expect(
      await drawer.getByRole("button", { name: "Clear selected bead", exact: true }).count(),
      "failed writes retain the selected target",
    ).toBe(1);
    expect(await type.inputValue(), "failed writes retain the chosen dependency type").toBe(
      "related",
    );
    expect(await comment.inputValue()).toBe("Preserve this comment through dependency writes.");
    await add().click();
    await add().waitFor({ state: "detached" });
    expect(writes.slice(0, 2), "retry posts the requested target and type").toStrictEqual([
      {
        method: "POST",
        path: "/api/p/demo/beads/current/deps",
        body: { depends_on_id: "exact-id", type: "related" },
      },
      {
        method: "POST",
        path: "/api/p/demo/beads/current/deps",
        body: { depends_on_id: "exact-id", type: "related" },
      },
    ]);
    expect(await comment.inputValue(), "successful writes preserve the comment draft").toBe(
      "Preserve this comment through dependency writes.",
    );

    await addDependency().click();
    await search().waitFor();
    expect(await search().inputValue(), "successful editor reopening resets its search").toBe("");
    expect(
      await drawer.locator('[cmdk-item][data-value="exact-id"]').count(),
      "newly linked target is excluded on reopen",
    ).toBe(0);
    await search().fill("bulk-00");
    await search().press("Enter");
    await add().dblclick();
    await pending;
    expect(
      writes.filter((w) => w.body.depends_on_id === "bulk-00").length,
      "pending add dedupes double clicks",
    ).toBe(1);
    const clearSelected = drawer.getByRole("button", { name: "Clear selected bead", exact: true });
    await clearSelected.waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLButtonElement>('[aria-label="Clear selected bead"]')
          ?.disabled === true,
    );
    expect(await clearSelected.isDisabled(), "pending add freezes the selected target").toBe(true);
    expect(await type.isDisabled(), "pending add freezes the type").toBe(true);
    expect(await add().isDisabled(), "pending add disables submission").toBe(true);
    expect(await cancel().isDisabled(), "pending add cannot be cancelled").toBe(true);
    releasePending();
    await add().waitFor({ state: "detached" });
    expect(
      writes.at(-1),
      "the default blocked-by type posts the canonical dependency direction",
    ).toStrictEqual({
      method: "POST",
      path: "/api/p/demo/beads/current/deps",
      body: { depends_on_id: "bulk-00", type: "blocks" },
    });

    await addDependency().click();
    await search().fill("a-1");
    await cancel().click();
    await search().waitFor({ state: "detached" });
    expect(await drawer.count(), "Cancel dependency only closes the editor").toBe(1);
    await addDependency().click();
    await search().press("Escape");
    await search().waitFor({ state: "detached" });
    expect(await drawer.count(), "Escape only closes the editor").toBe(1);

    await addDependency().click();
    await search().fill("a-2");
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: true } });
    await page.getByRole("button", { name: "Read Only Mode", exact: true }).waitFor();
    expect(await search().isDisabled(), "read-only freezes an open dependency editor").toBe(true);
    expect(await add().isDisabled(), "read-only prevents new dependency writes").toBe(true);
    expect(
      await options().first().getAttribute("aria-disabled"),
      "read-only cmdk options are explicitly disabled",
    ).toBe("true");
    expect(writes.length, "cancellation and read-only mode send no additional writes").toBe(3);
    console.log(
      "PASS: dependency search filters, ranks, selection, retries, pending state, cancellation, draft retention, and read-only guards",
    );
  } catch (error) {
    console.error({
      url: page?.url(),
      body: page ? (await page.locator("body").innerText()).slice(0, 3000) : "",
    });
    throw error;
  }
});
