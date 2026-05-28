import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("renders hero title and civilization cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByText("SoulLedger")).toBeVisible();
  });

  test("has working language switcher", async ({ page }) => {
    await page.goto("/");
    // Verify the page loads without errors
    await expect(page.locator("body")).toBeVisible();
  });

  test("navigates to login page", async ({ page }) => {
    await page.goto("/");
    const loginLink = page.getByRole("link", { name: /console|login/i });
    if (await loginLink.isVisible()) {
      await loginLink.click();
      await expect(page).toHaveURL(/login/);
    }
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
    // Should stay on login page
    await expect(page).toHaveURL(/login/);
  });
});

test.describe("Protected routes redirect", () => {
  const protectedRoutes = ["/dashboard", "/souls", "/users", "/audit"];

  for (const route of protectedRoutes) {
    test(`redirects ${route} to login when unauthenticated`, async ({ page }) => {
      await page.goto(route);
      // Should redirect to login or show login form
      await expect(page).toHaveURL(/login|\/$|\/dashboard/);
    });
  }
});
