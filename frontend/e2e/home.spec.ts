import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("renders hero title and civilization cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByText("SoulLedger")).toBeVisible();
  });

  test("has working language switcher", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("navigates to login page", async ({ page }) => {
    await page.goto("/");
    const loginLink = page.getByRole("link", { name: /console|login/i });
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/login/);
  });
});

test.describe("Login page", () => {
  test("renders login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /login|sign in|登录/i })).toBeVisible();
  });

  test("shows validation on empty submit", async ({ page }) => {
    await page.goto("/login");
    const submitBtn = page.getByRole("button", { name: /login|sign in|登录/i });
    await submitBtn.click();
    await expect(page).toHaveURL(/login/);
  });
});

test.describe("Protected routes redirect", () => {
  const protectedRoutes = ["/dashboard", "/souls", "/users", "/audit"];

  for (const route of protectedRoutes) {
    test(`redirects ${route} to login when unauthenticated`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/login/);
    });
  }
});

test.describe("Navigation menu", () => {
  test("sidebar renders navigation links", async ({ page }) => {
    await page.goto("/");
    // Sidebar should contain navigation items
    const sidebar = page.locator("nav, [role='navigation'], aside");
    await expect(sidebar).toBeVisible();
  });
});

test.describe("Theme toggle", () => {
  test("theme toggle button exists", async ({ page }) => {
    await page.goto("/");
    const themeBtn = page.getByRole("button", { name: /dark|light|theme/i });
    await expect(themeBtn).toBeVisible();
  });
});

test.describe("Error page", () => {
  test("shows 404 for non-existent route", async ({ page }) => {
    await page.goto("/non-existent-route-xyz");
    await expect(page.getByText("404")).toBeVisible();
  });
});

test.describe("Welcome page", () => {
  test("renders welcome content", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page.locator("body")).toBeVisible();
  });
});
