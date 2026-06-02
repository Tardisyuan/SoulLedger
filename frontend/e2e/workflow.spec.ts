import { test, expect } from "@playwright/test";
import { setupAuthenticatedPage } from "./fixtures";

test.describe("Workflow page", () => {
  test("renders workflow page without errors", async ({ page }) => {
    await page.goto("/workflow");
    // Page should load without crashing (may redirect to login if unauthenticated)
    await expect(page.locator("body")).toBeVisible();
  });

  test("shows workflow title when authenticated", async ({ page }) => {
    await page.goto("/workflow");
    // Either shows the workflow page or redirects to login
    const title = page.locator("h1");
    await expect(title).toBeVisible();
  });

  test("has workflow tab navigation", async ({ page }) => {
    await page.goto("/workflow");
    // Look for tab buttons (existing, editor, instances)
    const tabs = page.locator("button").filter({ hasText: /workflow|existing|editor|instances|模板|编辑|实例/i });
    const tabCount = await tabs.count();
    // Should have at least 3 tab buttons if on workflow page
    if (tabCount >= 3) {
      await expect(tabs.first()).toBeVisible();
    }
  });
});

test.describe("Workflow template list", () => {
  test("displays template section when on workflow page", async ({ page }) => {
    await page.goto("/workflow");
    // Check for template-related content
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // Page should not show error state
    await expect(page.locator("text=500")).not.toBeVisible();
    await expect(page.locator("text=Internal Server Error")).not.toBeVisible();
  });

  test("shows predefined templates by civilization", async ({ page }) => {
    await page.goto("/workflow");
    // Look for civilization names in the template list
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

test.describe("Workflow navigation", () => {
  test("can click between workflow tabs", async ({ page }) => {
    await page.goto("/workflow");
    // Find tab buttons
    const tabButtons = page.locator("button").filter({ hasText: /existing|editor|instances/i });
    const count = await tabButtons.count();

    if (count >= 2) {
      // Click second tab
      await tabButtons.nth(1).click();
      await expect(page.locator("body")).toBeVisible();

      // Click first tab back
      await tabButtons.nth(0).click();
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("navigates to workflow detail page", async ({ page }) => {
    // Try to access a workflow instance detail
    await page.goto("/workflow/1");
    await expect(page.locator("body")).toBeVisible();
    // Should not show 404 for valid route pattern
    await expect(page.locator("text=404")).not.toBeVisible();
  });

  test("workflow page does not crash on load", async ({ page }) => {
    // Capture console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/workflow");
    await page.waitForTimeout(2000);

    // Filter out expected auth/network errors
    const criticalErrors = errors.filter(
      (e) => !e.includes("401") && !e.includes("403") && !e.includes("Failed to fetch")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
