import { required } from "./bead-fixture";

type ApprovalWrite = { path: string; method: string; body: { status: string; reason: string } };

import { type Bead, beadSchema } from "../lib/schema";
import { expect, test } from "./fixtures";

test("approval", async ({ browser, baseURL }) => {
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();

  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: `Approval ${id}`,
      status: "open",
      issue_type: "gate",
      await_type: "human",
      priority: 2,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });

  const inboxGate = bead("inbox-gate", { description: "Approve this release decision." });
  const drawerGate = bead("drawer-gate", { description: "Approve this deployment decision." });
  const beads = [inboxGate, drawerGate];
  const writes: ApprovalWrite[] = [];
  let inboxAttempts = 0;
  let releaseDrawerApproval!: () => void;
  let markDrawerRequest!: () => void;
  const drawerRequest = new Promise<void>((resolve) => {
    markDrawerRequest = resolve;
  });

  function assertAuditableApproval(write: ApprovalWrite) {
    expect(write.method, "approval uses the status endpoint").toBe("POST");
    expect(write.path, "approval must not use a generic close action").toMatch(
      /\/beads\/(inbox-gate|drawer-gate)\/status$/,
    );
    expect(write.body.status).toBe("closed");
    expect(typeof write.body.reason, "approval always supplies an audit reason").toBe("string");
    expect(
      write.body.reason.length > 20,
      "approval reason is meaningful rather than a bare status change",
    ).toBeTruthy();
    expect(write.body.reason, "approval reason identifies the human actor").toMatch(/reviewer/i);
    expect(write.body.reason, "approval reason records approval intent").toMatch(/approv/i);
    expect(write.body.reason, "approval reason records when the human approved").toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/,
    );
  }

  let page!: import("@playwright/test").Page;
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

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
      writes.push({ path, method: request.method(), body });

      if (path.endsWith("/beads/inbox-gate/status") && inboxAttempts++ === 0) {
        return route.fulfill({ status: 500, json: { error: "temporary failure" } });
      }
      if (path.endsWith("/beads/drawer-gate/status")) {
        markDrawerRequest();
        await new Promise<void>((resolve) => {
          releaseDrawerApproval = resolve;
        });
      }
      const target = required(beads.find((entry) => path.endsWith(`/beads/${entry.id}/status`)));
      if (target) target.status = "closed";
      return route.fulfill({ json: target ?? {} });
    });

    await page.goto(`${base}/p/demo`);
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
    await page
      .getByRole("button", { name: "Read Only Mode", exact: true })
      .waitFor({ state: "detached" });
    await page.getByRole("button", { name: /^Needs You(?:\s+\d+)?$/ }).click();
    const inboxCard = page.locator('[data-keyboard-bead-id="inbox-gate"]');
    await inboxCard.waitFor();

    // A typed approval note survives a failed request and is appended to the audit reason on retry.
    const directApprove = inboxCard.getByRole("button", { name: "Approve", exact: true });
    await inboxCard.getByRole("button", { name: "Add approval note", exact: true }).click();
    const inboxNote = inboxCard.getByPlaceholder("Optional approval note", { exact: true });
    const noteText = "The release owner confirmed the rollback plan.";
    await inboxNote.fill(noteText);
    const firstRequest = page.waitForRequest((request) =>
      request.url().endsWith("/beads/inbox-gate/status"),
    );
    await directApprove.click();
    await firstRequest;
    await page.getByText(/temporary failure/i).waitFor();
    expect(dialogs.length, "direct approval does not require an extra browser prompt").toBe(0);
    expect(writes.length).toBe(1);
    assertAuditableApproval(writes[0]);
    expect(writes[0].body.reason).toMatch(/The release owner confirmed the rollback plan\./);
    await directApprove.waitFor();
    expect(
      await directApprove.isEnabled(),
      "a failed approval keeps the gate open and retryable",
    ).toBe(true);
    expect(await inboxNote.inputValue(), "a failed approval preserves the exact note draft").toBe(
      noteText,
    );
    await directApprove.click();
    await page.waitForFunction(
      () => document.querySelector('[data-keyboard-bead-id="inbox-gate"]') === null,
    );
    expect(writes.length, "a failed approval can be retried once").toBe(2);
    assertAuditableApproval(writes[1]);
    expect(writes[1].body.reason).toMatch(/The release owner confirmed the rollback plan\./);

    // The drawer uses the same approval contract and suppresses duplicate pending clicks.
    await page.getByText("drawer-gate", { exact: true }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("heading", { name: "Approval drawer-gate", exact: true }).waitFor();
    const drawerApprove = drawer.getByRole("button", { name: "Approve", exact: true });
    await drawerApprove.dblclick();
    await drawerRequest;
    expect(
      writes.filter((write) => write.path.endsWith("/beads/drawer-gate/status")).length,
      "pending double clicks make one approval request",
    ).toBe(1);
    assertAuditableApproval(writes[2]);
    expect(
      "note" in writes[2].body,
      "direct approval works without sending an empty note field",
    ).toBe(false);
    releaseDrawerApproval();
    await drawerApprove.waitFor({ state: "detached" });
    await drawer.getByTitle("Close", { exact: true }).click();
    await drawer.waitFor({ state: "detached" });
    expect(dialogs.length, "drawer approval does not require an extra browser prompt").toBe(0);

    // Viewer mode remains an absolute write guard on both surfaces.
    await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: true } });
    await page.getByRole("button", { name: /^Needs You(?:\s+\d+)?$/ }).click();
    const readOnlyGate = bead("read-only-gate");
    beads.push(readOnlyGate);
    await page.reload();
    await page.getByRole("button", { name: /^Needs You(?:\s+\d+)?$/ }).click();
    const readOnlyCard = page.locator('[data-keyboard-bead-id="read-only-gate"]');
    await readOnlyCard.getByRole("button", { name: "Approve", exact: true }).waitFor();
    expect(
      await readOnlyCard.getByRole("button", { name: "Approve", exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByText("read-only-gate", { exact: true }).click();
    await drawer.getByRole("button", { name: "Approve", exact: true }).waitFor();
    expect(await drawer.getByRole("button", { name: "Approve", exact: true }).isDisabled()).toBe(
      true,
    );
    expect(writes.length, "read-only mode never sends an approval write").toBe(3);
    writes.forEach(assertAuditableApproval);

    console.log(
      "PASS: audit-ready approvals from Needs You and drawer, retry/note preservation, pending dedupe, and read-only guards",
    );
  } catch (error) {
    console.error({
      url: page?.url(),
      body: page ? (await page.locator("body").innerText()).slice(0, 3000) : "",
    });
    throw error;
  }
});
