import { test, expect } from "@playwright/test";
import { mockApi, setupAuthenticatedPage } from "./fixtures";

/**
 * Public-surface and routing checks.
 *
 * Every assertion here names something the page must actually contain. The
 * previous version leaned on `expect(page.locator("body")).toBeVisible()`,
 * which passes against a blank page, a 500, or a redirect to somewhere else
 * entirely — <body> exists on all of them.
 */

test.describe("Home page", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("renders hero title and all three civilization cards", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText("灵魂账本");
    await expect(page.getByText("跨文明灵魂管理系统")).toBeVisible();
    await expect(page.getByRole("heading", { name: "文明体系" })).toBeVisible();

    // One card per civilization — the grid is the page's whole point.
    for (const civilization of ["中国地府", "欧洲天堂与地狱", "埃及冥界"]) {
      await expect(page.getByText(civilization, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("灵魂账本 v0.1")).toBeVisible();
  });

  test("language switcher re-renders the page in the chosen locale", async ({ page }) => {
    await page.goto("/");

    const switcher = page.getByLabel("界面语言");
    await expect(switcher).toBeVisible();
    await expect(page.getByText("万古轮回皆有录")).toBeVisible();

    await switcher.selectOption("en");

    // Same slot, English copy — proves the locale actually propagated
    // through I18nContext rather than the control merely existing.
    await expect(page.getByText("Every soul weighed, every life recorded")).toBeVisible();
    await expect(page.getByText("万古轮回皆有录")).toHaveCount(0);
  });

  test("theme toggle flips the root theme class", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);

    await page.getByTitle("切换到浅色模式").click();
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);

    await page.getByTitle("切换到深色模式").click();
    await expect(html).toHaveClass(/dark/);
  });

  test("console button navigates an anonymous visitor to login", async ({ page }) => {
    await page.goto("/");

    const consoleLink = page.getByRole("link", { name: /控制台/ });
    await expect(consoleLink).toHaveAttribute("href", "/login");
    await consoleLink.click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  });
});

test.describe("Login page", () => {
  test("renders the credential form", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");

    await expect(page.locator("h1")).toHaveText("灵魂账本");
    await expect(page.getByRole("heading", { name: "登录", level: 2 })).toBeVisible();
    await expect(page.getByLabel("用户名")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  test("empty submit is blocked before any request leaves the browser", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/login");

    await page.getByRole("button", { name: "登录" }).click();

    // Both fields are `required`, so the browser refuses the submit — the
    // real assertion is that no login attempt was made, not just that the
    // URL happens to be unchanged.
    await expect(page).toHaveURL(/\/login/);
    expect(api.countOf("POST", "/auth/login/")).toBe(0);
    await expect(page.getByLabel("用户名")).toHaveJSProperty("validity.valueMissing", true);
  });

  test("bad credentials surface an error and leave the user on /login", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/login");

    await page.getByLabel("用户名").fill("nobody");
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page.getByText("账号或密码错误")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(api.countOf("POST", "/auth/login/")).toBe(1);
  });
});

test.describe("Protected routes (unauthenticated)", () => {
  const protectedRoutes = ["/dashboard", "/souls", "/users", "/audit", "/permissions", "/dispatch"];

  for (const route of protectedRoutes) {
    test(`redirects ${route} to login and preserves the target`, async ({ page }) => {
      await mockApi(page);
      await page.goto(route);

      // middleware.ts:44 stashes the original path as ?redirect= — asserting
      // it means a redirect to a *generic* login page would fail.
      await expect(page).toHaveURL(`/login?redirect=${encodeURIComponent(route)}`);
      await expect(page.getByRole("heading", { name: "登录", level: 2 })).toBeVisible();
    });
  }
});

test.describe("Routing edge cases", () => {
  test("unknown route redirects an anonymous visitor to login", async ({ page }) => {
    await mockApi(page);
    await page.goto("/non-existent-route-xyz");

    await expect(page).toHaveURL(/\/login\?redirect=/);
  });

  test("unknown route renders 404 for an authenticated user", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/non-existent-route-xyz");

    // Past middleware now, so app/not-found.tsx is what should show.
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByRole("heading", { name: "页面未找到" })).toBeVisible();
  });

  test("welcome page is public and renders its quick actions", async ({ page }) => {
    await mockApi(page);
    await page.goto("/welcome");

    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.getByRole("heading", { name: "快捷操作" })).toBeVisible();
  });
});

test.describe("Authenticated shell", () => {
  test("sidebar renders the menu tree returned by the API", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/dashboard");

    // Not redirected — the seeded cookie satisfied middleware.
    await expect(page).toHaveURL(/\/dashboard/);

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    for (const [name, href] of [
      ["灵魂", "/souls"],
      ["调度管理", "/dispatch"],
      ["权限管理", "/permissions"],
      ["回收站", "/recycle-bin"],
    ]) {
      await expect(sidebar.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});
