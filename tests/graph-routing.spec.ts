import { expect } from "@playwright/test";
import { beadSchema } from "../lib/schema";
import { test } from "./fixtures";

test("dependency paths avoid card interiors, including fan-in inside epics", async ({
  page,
}, testInfo) => {
  const bead = (id: string, dependencies: string[] = []) =>
    beadSchema.parse({
      id,
      title: `Task ${id}`,
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      dependencies: [
        { depends_on_id: "epic", type: "parent-child" },
        ...dependencies.map((depends_on_id) => ({ depends_on_id, type: "blocks" })),
      ],
    });
  const beads = [
    {
      id: "epic",
      title: "Routing regression",
      status: "open",
      issue_type: "epic",
      priority: 2,
      dependencies: [],
      labels: [],
    },
    bead("start"),
    bead("middle", ["start"]),
    bead("tall", ["start"]),
    bead("finish", ["middle", "tall", "start"]),
  ];
  beads[3].title = "An intermediate card with a long title that must stay readable ".repeat(8);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path.endsWith("/beads"))
      return route.fulfill({
        json: { beads, meta: { kind: "demo", humanAllowlist: [], pollIntervalMs: 300000 } },
      });
    if (path === "/api/viewer-mode") return route.fulfill({ json: { readOnly: true } });
    return route.continue();
  });
  await page.goto("/p/demo?view=graph");
  await expect(page.locator(".react-flow__node-bead")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(5);
  await expect
    .poll(async () =>
      page.locator(".react-flow__edge-path").evaluateAll((paths) => {
        const boxes = [...document.querySelectorAll(".react-flow__node-bead")].map((n) =>
          n.getBoundingClientRect(),
        );
        return paths.flatMap((element) => {
          const path = element as SVGPathElement;
          const matrix = path.getScreenCTM();
          if (!matrix || !path.getAttribute("d")) return ["missing path"];
          const hits: string[] = [];
          for (let length = 2; length < path.getTotalLength() - 2; length += 2) {
            const point = path.getPointAtLength(length).matrixTransform(matrix);
            if (
              boxes.some(
                (b) =>
                  point.x > b.left + 2 &&
                  point.x < b.right - 2 &&
                  point.y > b.top + 2 &&
                  point.y < b.bottom - 2,
              )
            )
              hits.push(path.id);
          }
          return hits;
        });
      }),
    )
    .toStrictEqual([]);
  await page.screenshot({ path: testInfo.outputPath("routed-graph.png") });
});
