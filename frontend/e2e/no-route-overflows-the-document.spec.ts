/**
 * 没有哪条路由把**整个文档**撑得比视口宽。
 *
 * WHY。全仓 grep `scrollWidth|clientWidth`,在 `e2e/` 与 `src/__tests__/` 下
 * **零命中**。三条 mobile-chrome 的长期失败(2026-08-28 修好的那批)根因正是文档
 * 横向溢出,而它们各自的报错指向三个不同的按钮、两个不同的页面 —— 修好之后,
 * 没有任何东西钉住这个判据,同样的东西再来一次仍然会以「某个按钮点不动」的
 * 面目出现。
 *
 * 后果不只是多一条横向滚动条:所有 `fixed inset-0` 的遮罩与弹窗容器都按文档宽度
 * 铺开。文档 738 而视口 393,弹窗就居中在 369,一半落在可视区外,里面的按钮
 * 「可见、可用、可滚动到」却点不动。
 *
 * WHAT THE CRITERION IS。`documentElement.scrollWidth` 对 `clientWidth`,不是
 * 「哪个元素看起来超出去了」。后者会把滚动容器内被正常裁剪的子元素也算进去,
 * 给出一串与文档宽度无关的答案 —— `/permissions` 上实测 127 个「超宽元素」,
 * 每一个都有 overflow-x 祖先,而文档确实是宽的。
 */
import { expect, test } from "@playwright/test";

import { setupAuthenticatedPage } from "./fixtures";

/** 共用 PageShell / 同一套布局的静态路由。动态路由([id])要另配 fixture,
 *  不在这个文件的范围内 —— 它们的容器是同一批,溢出会先在这里出现。 */
const ROUTES = [
  "/dashboard",
  "/souls",
  "/judgment",
  "/judgment/queue",
  "/disposition",
  "/ledger",
  "/workflow",
  "/dispatch",
  "/dispatch/propose",
  "/cross-judgments",
  "/audit",
  "/menus",
  "/menus/buttons",
  "/users",
  "/permissions",
  "/tenants",
  "/realms",
  "/actors",
  "/organizations",
  "/corpus",
  "/notifications",
  "/social",
  "/social/follows",
  "/profile",
  "/recycle-bin",
  "/death-sync",
];

test.describe("文档不比视口宽", () => {
  for (const route of ROUTES) {
    test(`${route}`, async ({ page }) => {
      await setupAuthenticatedPage(page);
      await page.goto(route);
      // 等外壳挂上再量。挂载之前 documentElement 只有一个空 body,
      // 那时候量到的 393/393 是「什么都还没渲染」,不是「没有溢出」。
      await expect(page.locator("body")).not.toBeEmpty();
      await page.waitForLoadState("networkidle");

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        scrollWidth,
        `${route}: 文档 ${scrollWidth}px 宽,视口 ${clientWidth}px —— ` +
          `所有 fixed inset-0 的遮罩与弹窗会按 ${scrollWidth} 铺开并居中在 ` +
          `${Math.round(scrollWidth / 2)},一半落在可视区外`
      ).toBeLessThanOrEqual(clientWidth);
    });
  }
});
