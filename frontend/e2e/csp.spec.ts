import type { Page } from "@playwright/test";
import { test, expect, mockApi, setupAuthenticatedPage } from "./fixtures";

/**
 * The page CSP (frontend/proxy.ts) has no 'unsafe-inline' in script-src: every
 * script runs because it carries this request's nonce or was loaded by one that
 * did ('strict-dynamic'). A script that lost its nonce does not throw — it
 * just never runs, and the only trace is a console line. So collect the
 * browser's own `securitypolicyviolation` events, from before any page script.
 */
async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

async function scriptSrc(page: Page, path: string): Promise<string> {
  const res = await page.request.get(path);
  const csp = res.headers()["content-security-policy"] ?? "";
  return csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
}

test.describe("Content-Security-Policy", () => {
  test("the login page runs under a nonce CSP with no violations", async ({ page }) => {
    await mockApi(page);
    const violations = await recordViolations(page);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    // Hydrated: the controlled input takes typing only once React is running.
    await page.getByLabel("账号").fill("probe");
    await expect(page.getByLabel("账号")).toHaveValue("probe");
    // The theme bootstrap ran (it is the one inline script this repo writes).
    await expect(page.locator("html")).toHaveClass(/\b(dark|light)\b/);
    expect(await violations()).toEqual([]);

    const script = await scriptSrc(page, "/login");
    expect(script).toMatch(/'nonce-[^']+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  test("an authenticated page renders with no violations", async ({ page }) => {
    await setupAuthenticatedPage(page);
    const violations = await recordViolations(page);
    await page.goto("/souls");
    await expect(page.locator("h1")).toHaveText("灵魂");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});
