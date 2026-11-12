import { expect, test } from "@playwright/test";
import { clean, enter, watch } from "./support";

// 2026-11-12 作品集建议 A1:演示首页有「这是怎么做的」(正式版落地页的同一个组件),导览结尾的链接到得了它。
test("the home page shows how it was built: architecture, test counts, the two app recordings", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  const section = page.locator("#how-built");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId("landing-architecture")).toBeVisible();
  await expect(section.getByTestId("landing-numbers").locator("dd")).toHaveCount(5);
  await expect(section.locator("video")).toHaveCount(2);
  clean(seen, "home how-built");
});

// A3:第二条导览,以管理员身份,每一步点亮界面上真实的东西。
test("the safeguards tour enters as the administrator and lights up something on each of its six steps", async ({ page, context }) => {
  test.setTimeout(90000);
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  const card = page.locator('[data-testid="demo-tour"][data-tour="guard"]');
  await expect(card).toBeVisible();
  const routes = ["/tenants", "/permissions", "/permissions", "/permissions", "/audit", "/recycle-bin"];
  const dark: string[] = [];
  for (const [i, route] of routes.entries()) {
    await expect(page.getByTestId("demo-tour-progress")).toContainText(`${i + 1} / 6`);
    await expect(page.getByTestId("demo-tour-next")).toBeVisible({ timeout: 10000 });
    expect(new URL(page.url()).pathname).toBe(route);
    const lit = await page.locator(".demo-tour-target").first().waitFor({ timeout: 6000 }).then(() => true, () => false);
    if (!lit) dark.push(`${i + 1}:${route}`);
    await page.getByTestId("demo-tour-next").click();
  }
  expect(dark, "steps with nothing highlighted").toEqual([]);
  await expect(page.locator('[data-testid="demo-tour"][data-finished]')).toBeVisible();
  await expect(page.locator('[data-testid^="demo-tour-other-"]')).toHaveCount(4);
  clean(seen, "guard tour");
});

// A4:越权试验回放的是录下来的真实 403,不是演示编的成功。
test("the overreach step replays the judge's recorded 403, with the reason and where it is enforced", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  await page.getByTestId("demo-tour-next").click();
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("3 / 6");
  await page.getByTestId("demo-overreach-try").click();
  const answer = page.getByTestId("demo-overreach-answer");
  await expect(page.getByTestId("demo-overreach-status")).toHaveText("403");
  await expect(answer).toContainText("You do not have permission to perform this action.");
  await expect(answer).toContainText("demo_judge");
  await expect(answer).toContainText("CanReadPermissionCatalogue");
  // Still the administrator's console: the probe changed no one's sign-in.
  await expect(page.locator("main table").first()).toBeVisible();
  clean(seen, "overreach");
});

test("the administrator from the roles row still opens on the dashboard, with no tour", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  await page.goto("/");
  await page.getByTestId("demo-enter-admin").click();
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/tenants");
  await page.getByTestId("demo-entrance").waitFor({ state: "detached" });
  await expect(page.getByTestId("demo-tour")).toHaveCount(0);
});

test("the finished tour's 「这是怎么做的」 lands on that section, not on a missing anchor", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge_eu");
  await page.getByTestId("demo-tour-skip").click();
  await page.getByTestId("demo-tour-how-built").click();
  await page.waitForURL((u) => u.pathname === "/" && u.hash === "#how-built");
  await expect(page.locator("#how-built")).toBeInViewport();
  clean(seen, "tour how-built link");
});
