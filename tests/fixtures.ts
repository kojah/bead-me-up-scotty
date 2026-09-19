import { test as base } from "@playwright/test";

// Migrated flows sometimes open several contexts (browser-isolation tests).
// Playwright Test records artifacts for all of them; close them after each test
// without closing its worker-owned browser.
export const test = base.extend<{ cleanupContexts: void }>({
  cleanupContexts: [
    async ({ browser }, use) => {
      await use();
      await Promise.all(browser.contexts().map((context) => context.close()));
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
