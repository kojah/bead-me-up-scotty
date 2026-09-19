import { reviewLinks } from "../lib/review-links";
import { type Bead, beadSchema } from "../lib/schema";
import { makeBead } from "./bead-fixture";
import { expect, test } from "./fixtures";

test("review links", async ({ browser, baseURL }) => {
  const input = {
    description:
      "[Review](https://example.com/review_(draft)) ![screenshot](attachment://decision/screen.png)",
    notes: "https://example.com/review_(draft) /api/p/demo/attachments/decision/local.png",
    design: "https://example.org/design.",
    comments: [
      {
        author: "reviewer",
        text: "https://example.net/comment javascript:alert(1) file:///private/secret",
      },
    ],
  };
  expect([...reviewLinks(makeBead("review", input))]).toStrictEqual([
    "https://example.com/review_(draft)",
    "attachment://decision/screen.png",
    "/api/p/demo/attachments/decision/local.png",
    "https://example.org/design",
    "https://example.net/comment",
  ]);
  expect(
    reviewLinks(
      makeBead("review", {
        description:
          "javascript:alert(1) data:text/html,test file:///tmp/foo attachment://../bad /api/p/demo/attachments/../../shutdown",
      }),
    ).length,
  ).toBe(0);
  expect(
    reviewLinks(
      makeBead("review", { description: "An explanation can be reviewed without any links." }),
    ).length,
  ).toBe(0);
  const base = baseURL;
  expect(base, "Playwright baseURL must be configured").toBeTruthy();
  const bead = (id: string, extra: Partial<Bead> = {}) =>
    beadSchema.parse({
      id,
      title: id,
      issue_type: "task",
      status: "open",
      priority: 2,
      labels: [],
      dependencies: [],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      ...extra,
    });
  const beads = [
    bead("decision", { labels: ["human"], ...input }),
    bead("gate", {
      issue_type: "gate",
      await_type: "human",
      description: "Please review the explanation in this bead.",
    }),
  ];

  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/p/demo/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().method(), "review-link browsing never writes").toBe("GET");
    if (path.endsWith("/beads/stream")) return route.abort();
    return route.fulfill({
      json: path.endsWith("/beads")
        ? {
            beads,
            meta: {
              kind: "demo",
              humanActor: "reviewer",
              humanAllowlist: ["reviewer"],
              pollIntervalMs: 300000,
            },
          }
        : {},
    });
  });
  const open = async () => {
    await page.goto(`${base}/p/demo`);
    await page.getByRole("button", { name: "Needs You", exact: true }).click();
    await page.getByText("Links & attachments", { exact: true }).waitFor();
  };
  await open();
  const card = page.locator('[data-keyboard-bead-id="decision"]');
  const links = await card.locator("a").evaluateAll((as) =>
    as.map((a) => ({
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
    })),
  );
  expect(links.length).toBe(5);
  expect(
    links.some((a) => a.href === "/api/p/demo/attachments/decision/screen.png"),
    "attachment refs resolve to the current project",
  ).toBeTruthy();
  expect(
    links.some((a) => a.href === "/api/p/demo/attachments/decision/local.png"),
    "local API attachment links are surfaced",
  ).toBeTruthy();
  expect(links.every((a) => a.target === "_blank" && a.rel?.includes("noopener"))).toBeTruthy();
  await page
    .getByText("No supporting links found. Review the bead details before deciding.", {
      exact: true,
    })
    .waitFor();
  expect(
    await page.getByRole("button", { name: "Approve", exact: true }).isDisabled(),
    "read-only approval guard remains",
  ).toBe(true);
  await context.request.put(`${base}/api/viewer-mode`, { data: { readOnly: false } });
  await open();
  expect(
    await page.getByRole("button", { name: "Approve", exact: true }).isEnabled(),
    "absence of links does not become an approval gate",
  ).toBe(true);
  expect(errors).toStrictEqual([]);
  console.log(
    "PASS: supporting link discovery, Markdown delimiters, local attachments, safe schemes, read-only access and non-gating empty state",
  );
});
