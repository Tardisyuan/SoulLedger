import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3333";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  /**
   * All three projects now run in CI, one matrix leg each (.github/workflows/
   * ci.yml). They used not to: CI invoked `--project=chromium` only, so
   * firefox and mobile-chrome had never been executed at all. When they were
   * first run by hand on 2026-08-13, mobile-chrome came back 32/35 — two of
   * those failures were real narrow-viewport defects, since fixed:
   *
   *   1. AppLayout's right-hand control cluster wrapped onto several lines at
   *      393px, grew past the 64px header and — the header being sticky and
   *      z-40 — the overflow covered the `+ 创建灵魂` button on /souls and ate
   *      the click. Fixed by `shrink-0 whitespace-nowrap` on the cluster plus
   *      `hidden sm:*` on the widest controls.
   *   2. /workflow's `flex` + `w-80 shrink-0` two-column row left the preview
   *      pane 1px wide at 393px. Fixed by stacking below `lg`.
   *
   * The third failure was NOT a mobile defect and is still here: several
   * assertions in e2e/workflow.spec.ts use non-unique text locators, and
   * during a dev-server compile React parks a copy of the streamed subtree in
   * a `<div hidden>` at the top of <body> before splicing it in. While that
   * copy exists the locator matches twice and Playwright raises a strict-mode
   * violation, which it does not retry away. It is engine-agnostic —
   * `--repeat-each=6` reproduces it 7-8 times in 42 on chromium, which has
   * been in CI all along — so it is not a reason to hold mobile-chrome back.
   * `retries: 2` below absorbs it; the fix is unique locators in the spec.
   */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
  /**
   * Only the Next.js dev server — there is no Django here. Every request to
   * `/api/v1/**` is answered by Playwright route mocks (see e2e/fixtures.ts),
   * which is what keeps this suite runnable in CI without Postgres or Redis.
   */
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
