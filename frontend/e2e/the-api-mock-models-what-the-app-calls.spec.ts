/**
 * ApiMock 没有模型化的请求,不能悄悄拿到一个 `200 {results: []}`。
 *
 * WHY。`fixtures.ts` 的回退给未匹配的请求返回一个空页,并把 `handled=false`
 * 记在调用记录上 —— **而没有任何 spec 读过那个标志**(全仓 grep 只有 ApiMock
 * 自己的写入)。后果:应用哪天开始调一个新端点,它会拿到一个自信的空列表,
 * 所有 spec 保持绿。`workflow.spec.ts:140` 的注释把这个陷阱写了下来,并绕开了它。
 *
 * 这个文件是那个标志的**读者**。它逐条路由打开页面,然后要求 ApiMock 对每一个
 * `/api/v1/**` 请求都有 handler —— 背景噪音(通知轮询、菜单、社交、审计日志)
 * 在 `BACKGROUND_PATHS` 里逐条列名,不在名单上的算失败。
 *
 * 同时钉住 WebSocket:`page.route` 只管 HTTP,所以 `packages/core/src/ws/client.ts` 整个逃过了
 * mock —— 一个把 socket 指到错误主机的回归对整套 e2e 不可见。
 * `interceptWebSockets` 把打开过的 URL 记下来,这里断言它们指向本机。
 */
import { expect, test } from "@playwright/test";

import { setupAuthenticatedPage } from "./fixtures";

const ROUTES = [
  "/dashboard",
  "/souls",
  "/judgment",
  "/ledger",
  "/workflow",
  "/dispatch",
  "/audit",
  "/users",
  "/permissions",
  "/tenants",
  "/realms",
  "/actors",
  "/corpus",
  "/notifications",
  "/social",
  "/profile",
  "/death-sync",
];

test.describe("ApiMock 覆盖了应用真的会调的东西", () => {
  for (const route of ROUTES) {
    test(`${route} 没有落到默认空页`, async ({ page }) => {
      const api = await setupAuthenticatedPage(page);
      await page.goto(route);
      // 等到确实有请求发出为止,而不是 `networkidle`。
      // `networkidle` 在 firefox 上会在应用的查询发出**之前**就 resolve ——
      // 实测过一次,于是「一条都没记到」和「一条都没漏」输出一样。
      await expect
        .poll(() => api.calls.length, { timeout: 15_000 })
        .toBeGreaterThan(0);
      await page.waitForLoadState("networkidle");

      const stray = api.unexpectedUnhandled();
      expect(
        stray.map((c) => `${c.method} ${c.path}`),
        "这些请求拿到了一个默认的 200 空列表;给它们注册 handler,或(确实是背景噪音的话)加进 BACKGROUND_PATHS"
      ).toEqual([]);
    });
  }

  test("这套断言确实看到了请求 —— 守卫的守卫", async ({ page }) => {
    // 上面每一条都是 `expect([...]).toEqual([])`。**一个请求都没记到时它最干净**,
    // 而「拦截器坏了」和「全部都被处理了」输出一模一样。
    const api = await setupAuthenticatedPage(page);
    await page.goto("/souls");
    await expect
      .poll(() => api.calls.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(api.calls.some((c) => c.handled)).toBe(true);
  });
});

test.describe("WebSocket 不再逃过 fixture", () => {
  test("打开的 socket 与应用真正调用的 API 同源,只换协议", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/notifications");
    // 客户端是否连、什么时候连,取决于页面;这里只在它连了的时候检查它连去哪。
    await page.waitForTimeout(1500);

    expect(api.apiOrigin, "一条 API 请求都没记到,下面的比较无从谈起").not.toBeNull();
    const expected = api.apiOrigin!.replace(/^http/, "ws");
    for (const url of api.socketUrls) {
      expect(url, `socket 连到了 ${url},而 API 在 ${api.apiOrigin}`).toContain(expected);
    }
  });
});
