import { type Bead, beadSchema } from "../lib/schema";
import { required } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("reassignment", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: `Reassignment ${id}`,
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });

  const target = bead("target", { assignee: "Alice" });
  const beads = [target, bead("existing", { assignee: "Bob" }), bead("unassigned")];
  const writes: { path: string; method?: string; body: Record<string, unknown> }[] = [];
  let failOnce = true;
  let releasePending!: () => void;
  let markPending!: () => void;
  const pendingRequest = new Promise<void>((resolve) => {
    markPending = resolve;
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
      if (request.method() === "GET") return respondToRead();
      function respondToRead() {
        if (path.endsWith("/beads")) {
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
        }
        return route.fulfill({
          json: beads.find((entry) => path.endsWith(`/beads/${entry.id}`)) ?? {},
        });
      }

      const body = request.postDataJSON();
      writes.push({ method: request.method(), path, body });
      if (path.endsWith("/beads/target") && body.assignee === "Retry Agent" && failOnce) {
        failOnce = false;
        return route.fulfill({ status: 500, json: { error: "temporary reassignment failure" } });
      }
      if (path.endsWith("/beads/target") && body.assignee === "Slow Agent") {
        markPending();
        await new Promise<void>((resolve) => {
          releasePending = resolve;
        });
      }
      const changed = required(beads.find((entry) => path.endsWith(`/beads/${entry.id}`)));
      if (changed) Object.assign(changed, body);
      return route.fulfill({ json: changed ?? {} });
    });

    await page.goto(`${base}/p/demo`);
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
    await page
      .getByRole("button", { name: "Read Only Mode", exact: true })
      .waitFor({ state: "detached" });
    await page.getByText("Reassignment target", { exact: true }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("heading", { name: "Reassignment target", exact: true }).waitFor();
    const change = () => drawer.getByRole("button", { name: "Change assignee", exact: true });
    const editor = () => drawer.locator('[aria-label="Assignee"]');
    const save = () => drawer.getByRole("button", { name: "Save assignee", exact: true });
    const cancel = () => drawer.getByRole("button", { name: "Cancel assignee edit", exact: true });
    const comment = drawer.getByPlaceholder(/^Comment as/);
    await comment.fill("Keep this comment draft through reassignment.");

    // Names offered by the datalist are useful defaults, but do not constrain assignment.
    await change().click();
    await editor().waitFor();
    expect(await editor().getAttribute("placeholder")).toBe("Unassigned");
    const suggestions = await editor().evaluate((input: HTMLInputElement) =>
      [...(input.list?.options ?? [])].map((option) => option.value),
    );
    expect(suggestions.includes("Alice"), "existing assignees are suggested").toBeTruthy();
    expect(suggestions.includes("Bob"), "every fixture assignee is suggested").toBeTruthy();
    expect(suggestions.includes("reviewer"), "the current human actor is suggested").toBeTruthy();
    await editor().fill("New Agent");
    await editor().press("Enter");
    await save().waitFor({ state: "detached" });
    expect(writes[0], "saving a new arbitrary assignee patches only assignee").toStrictEqual({
      method: "PATCH",
      path: "/api/p/demo/beads/target",
      body: { assignee: "New Agent" },
    });
    expect(await comment.inputValue(), "assignee saves do not disturb the comment draft").toBe(
      "Keep this comment draft through reassignment.",
    );
    expect(await drawer.count(), "assignee saves leave the drawer open").toBe(1);

    // A reload reads the updated intercepted fixture, proving the UI did not merely retain local text.
    await page.reload();
    await drawer.getByRole("heading", { name: "Reassignment target", exact: true }).waitFor();
    await change().click();
    expect(await editor().inputValue(), "reload shows the persisted fixture assignee").toBe(
      "New Agent",
    );
    await editor().fill("");
    await editor().press("Enter");
    await save().waitFor({ state: "detached" });
    await comment.fill("Keep this comment draft through reassignment.");
    expect(writes[1], "clearing uses an empty assignee patch").toStrictEqual({
      method: "PATCH",
      path: "/api/p/demo/beads/target",
      body: { assignee: "" },
    });

    const beforeCancel = writes.length;
    await change().click();
    await editor().fill("Do Not Save");
    await editor().press("Escape");
    await editor().waitFor({ state: "detached" });
    expect(writes.length, "Escape cancels without a write").toBe(beforeCancel);
    expect(await drawer.count(), "Escape cancels assignee editing without closing the drawer").toBe(
      1,
    );
    expect(await change().isEnabled()).toBe(true);

    await change().click();
    await editor().fill("Retry Agent");
    await save().click();
    await page.getByText(/temporary reassignment failure/i).waitFor();
    expect(await editor().inputValue(), "a failed save retains the exact assignee draft").toBe(
      "Retry Agent",
    );
    expect(await comment.inputValue(), "a failed save retains the comment draft too").toBe(
      "Keep this comment draft through reassignment.",
    );
    await save().click();
    await save().waitFor({ state: "detached" });
    expect(
      writes.slice(2, 4),
      "failure retries exactly the same assignee-only patch",
    ).toStrictEqual([
      { method: "PATCH", path: "/api/p/demo/beads/target", body: { assignee: "Retry Agent" } },
      { method: "PATCH", path: "/api/p/demo/beads/target", body: { assignee: "Retry Agent" } },
    ]);

    await change().click();
    await editor().fill("Slow Agent");
    await save().dblclick();
    await pendingRequest;
    expect(
      writes.filter((write) => write.body.assignee === "Slow Agent").length,
      "pending saves suppress duplicate requests",
    ).toBe(1);
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLButtonElement>('[aria-label="Save assignee"]')?.disabled ===
        true,
    );
    expect(await editor().isDisabled(), "pending writes freeze the submitted draft").toBe(true);
    expect(await cancel().isDisabled(), "pending writes cannot be cancelled locally").toBe(true);
    releasePending();
    await save().waitFor({ state: "detached" });

    // Toggling viewer mode while an editor is visible locks every reassignment control and sends nothing.
    await change().click();
    await editor().fill("Never Written");
    const beforeReadOnly = writes.length;
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: true } });
    await page.getByRole("button", { name: "Read Only Mode", exact: true }).waitFor();
    expect(await editor().isDisabled()).toBe(true);
    expect(await save().isDisabled()).toBe(true);
    expect(await cancel().isDisabled()).toBe(true);
    await page.reload();
    await drawer.getByRole("heading", { name: "Reassignment target", exact: true }).waitFor();
    expect(
      await change().isDisabled(),
      "read-only drawer retains a disabled reassignment control",
    ).toBe(true);
    expect(writes.length, "read-only mode never sends an assignee write").toBe(beforeReadOnly);
    writes.forEach((write) =>
      expect(Object.keys(write.body), "assignee writes carry no unrelated fields").toStrictEqual([
        "assignee",
      ]),
    );

    console.log(
      "PASS: drawer assignee editing supports arbitrary names, clear/cancel/retry/pending behavior, persistence, drafts, and read-only guards",
    );
  } catch (error) {
    console.error({
      url: page?.url(),
      body: page ? (await page.locator("body").innerText()).slice(0, 3000) : "",
    });
    throw error;
  }
});
