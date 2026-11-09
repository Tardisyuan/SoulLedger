/**
 * 登出 → 「再会」(2026-11-10):AppLayout 的 handleLogout 先留便条(名字与文明,`src/lib/goodbye.ts`),
 * 再清掉会话、去 /goodbye;再会页读一次便条就删,六秒后回首页。刷新再会页是中性的。
 *
 * TEST_USER 是中国地府(CN_DIYU)的官员,所以再会页说的是地府那一句。
 * 软导航:登出到 /goodbye 不换文档,`seedAuthState` 的 init script 不会把令牌写回去 —— 下面断「令牌没了」
 * 量的是 logout() 本身。刷新会重跑 init script,所以令牌的断言都放在刷新之前。
 */
import { expect, test, setupAuthenticatedPage, TEST_USER } from "./fixtures";

test("登出:确认 → 再会页叫出名字与地府那一句,便条与令牌都不在了,刷新是中性的,六秒后回首页", async ({ page, context }) => {
  const api = await setupAuthenticatedPage(page);
  api.on("POST", "/auth/logout/", { detail: "ok" });
  await page.goto("/dashboard");

  await page.getByTestId("user-menu").click();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.getByRole("button", { name: "确认退出", exact: true }).click();

  await expect(page).toHaveURL(/\/goodbye$/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(`再会，${TEST_USER.display_name}`);
  await expect(page.getByText("灯已熄，簿已合。")).toBeVisible();
  expect(api.countOf("POST", "/auth/logout/")).toBe(1);

  // 名字已经画出来 = 便条已经读过(读完就删)。令牌在 sessionStorage 与旧 cookie 里都没了。
  const left = await page.evaluate(() => ({
    note: sessionStorage.getItem("soulledger_goodbye"),
    access: sessionStorage.getItem("soulledger_access"),
    user: localStorage.getItem("soulledger_user"),
  }));
  expect(left).toEqual({ note: null, access: null, user: null });
  expect((await context.cookies()).map((c) => c.name)).not.toContain("soulledger_access");

  // 刷新:便条已经没了,是中性的「再会」与「簿已合上。」,不再有名字或地府的句子。
  await page.reload();
  await expect(heading).toHaveText("再会");
  await expect(page.getByText("簿已合上。")).toBeVisible();
  await expect(page.getByText("灯已熄，簿已合。")).toHaveCount(0);

  // 倒计时六秒(GOODBYE_SECONDS),自己回首页。
  await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 10_000 });
});
