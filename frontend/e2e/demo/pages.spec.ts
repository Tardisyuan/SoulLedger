import { expect, test } from "@playwright/test";
import { BROKEN, clean, enter, recording, rows, watch, type Role } from "./support";

const STATIC = `/dashboard /about /actors /admin/assistant /admin/assistant/usage /admin/stats /audit /audit/logins /audit/permissions
  /audit/sessions /audit/stats /city-god-cases /city-gods /corpus /cross-judgments /death-sync /death-sync/api-keys /death-sync/tudi-gods
  /death-sync/webhooks /desk /dispatch /dispatch/propose /disposition /events /halls /judgment /judgment/appeals /judgment/capture-due
  /judgment/queue /ledger /menus /menus/buttons /moderation /notifications /organizations /permissions /profile /realms
  /rebirth-applications /rebirths /recycle-bin /scheduler /sentence-plans /sentence-requests /social /social/follows /soul-credentials
  /soul-inbox /souls /tenants /users /welcome /workflow`.split(/\s+/);

const DETAIL: [string, string][] = [
  ["/souls/", "/souls/"], ["/judgment/", "/judgment/"], ["/workflows/", "/workflow/"], ["/dispatch/records/", "/dispatch/"],
  ["/dispatch/cross-tenant-judgments/", "/cross-judgments/"], ["/audit-logs/", "/audit/"], ["/social/posts/", "/social/"],
  ["/judgment/appeals/", "/judgment/appeals/"],
];

const ROLES: Role[] = ["admin", "judge", "judge_eu", "judge_eg", "judge_gr", "moderator"];

for (const role of ROLES) {
  const rec = recording(role);
  // 总簿 is ADMIN only (`defaultView.ts`); anyone else is shown a 403 there, which is not this test's subject.
  const routes = [...STATIC, ...(role === "admin" ? ["/desk/overview"] : [])];
  for (const [list, route] of DETAIL) {
    const first = rows(rec, list)[0];
    if (first) routes.push(`${route}${first.id}`);
  }
  const author = rows(rec, "/social/posts/")[0]?.author as number | { id: number } | undefined;
  if (author) routes.push(`/social/profile/${typeof author === "object" ? author.id : author}`);

  test.describe(`as ${role}`, () => {
    for (const route of routes) {
      test(route, async ({ page, context }) => {
        const seen = watch(context, page);
        await enter(page, role);
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await expect(page.getByTestId("demo-banner")).toBeVisible();
        const main = page.locator("main").first();
        await expect(main).toBeVisible();
        // networkidle says nothing here: the data is already in the bundle, and the first paint can come after it.
        await expect.poll(async () => (await main.innerText()).trim().length, { message: `an empty shell on ${route}` }).toBeGreaterThan(20);
        expect((await main.innerText()).trim(), `error copy on ${route}`).not.toMatch(BROKEN);
        clean(seen, route);
      });
    }
  });
}

// The moderator holds neither cross_judgment.read, judgment.read nor ledger.read: the recording has a 403 for each list,
// and the page says it is not theirs instead of 「出错了」 (which the test above only missed when it read the page before
// the retry gave up).
for (const route of ["/cross-judgments", "/corpus", "/dashboard?tab=more"]) {
  test(`as moderator, ${route} says 没有权限 rather than that it failed`, async ({ page, context }) => {
    const seen = watch(context, page);
    await enter(page, "moderator");
    await page.goto(route);
    await expect(page.getByTestId("permission-denied")).toBeVisible();
    await expect(page.getByTestId("permission-denied")).toContainText("您没有权限访问此页面");
    expect((await page.locator("main").innerText()).trim()).not.toMatch(BROKEN);
    await expect(page.getByText("加载统计数据失败")).toHaveCount(0);
    clean(seen, route);
  });
}

for (const route of ["/login/verify", "/forgot-password", "/reset-password", "/verify-email", "/accept-invite"]) {
  test(`${route} is not part of the demo`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("demo-login")).toBeVisible();
  });
}

test("the landing page opens without signing in, four cards first", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await expect(page.getByTestId("landing-civs").getByRole("button")).toHaveCount(4);
  await expect(page.getByTestId("demo-home-steps").getByRole("listitem")).toHaveCount(3);
  clean(seen, "/");
});

test("the banner stays on top when the page scrolls under it", async ({ page }) => {
  await enter(page, "admin");
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, 600));
  const onTop = await page.evaluate(() => !!document.elementFromPoint(window.innerWidth / 2, 10)?.closest('[data-testid="demo-banner"]'));
  expect(onTop).toBe(true);
});
