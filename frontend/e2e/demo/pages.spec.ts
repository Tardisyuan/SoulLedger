import { expect, test } from "@playwright/test";
import { BROKEN, clean, enter, recording, rows, watch, type Role } from "./support";

const STATIC = `/dashboard /about /actors /admin/assistant /admin/assistant/usage /admin/stats /audit /audit/logins /audit/permissions
  /audit/sessions /audit/stats /city-god-cases /city-gods /corpus /cross-judgments /death-sync /death-sync/api-keys /death-sync/tudi-gods
  /death-sync/webhooks /dispatch /dispatch/propose /disposition /events /halls /judgment /judgment/appeals /judgment/capture-due
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
  const routes = [...STATIC];
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
        const text = (await main.innerText()).trim();
        expect(text, `error copy on ${route}`).not.toMatch(BROKEN);
        expect(text.length, `an empty shell on ${route}`).toBeGreaterThan(20);
        clean(seen, route);
      });
    }
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
  await expect(page.getByTestId("landing-numbers")).toBeVisible();
  clean(seen, "/");
});
