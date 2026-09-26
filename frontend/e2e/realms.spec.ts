import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * /realms against the route mock. The Duat in fixtures.ts carries the real `order` / `fork`
 * (realms/0022), so this is the one E2E that draws 称心二岔 rather than the 示意 fallback.
 */
test("the Duat renders as 称心二岔: two roads out of the weighing, the fail road a terminal", async ({ page }) => {
  await setupAuthenticatedPage(page);
  await page.goto("/realms");
  await page.getByRole("button", { name: /杜阿特/ }).click();

  const topo = page.getByTestId("realm-topology").locator("[data-route-topology]");
  await expect(topo).toHaveAttribute("data-route-topology", "fork_two");
  await expect(topo).toHaveAttribute("data-schematic", "false");
  await expect(topo.getByTestId("topology-schematic")).toHaveCount(0);

  const roads = topo.locator("[data-fork]");
  await expect(roads).toHaveCount(2);
  await expect(topo.locator('[data-fork="PASS"]')).not.toHaveAttribute("data-terminal", /.*/);
  await expect(topo.locator('[data-fork="FAIL"]')).toHaveAttribute("data-terminal", "dashed");
});
