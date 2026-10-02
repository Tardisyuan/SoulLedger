/**
 * 身份带殿名「<租户名> · <司 / 殿>」(用户 2026-10-02):每页写一个固定的司名,审判类页面写
 * 眼前这一案的殿。fixtures 的租户展示名是「中国地府」。各取一页代表四个司:
 * 概览 → 第十殿(Design A4)、语料 → 典籍司(A3)、权限 → 规制司(A1/A2 同司)、审判列表 → 刑名司。
 */
import { expect, test, setupAuthenticatedPage } from "./fixtures";

for (const [path, hall] of [
  ["/dashboard", "中国地府 · 第十殿"],
  ["/corpus", "中国地府 · 典籍司"],
  ["/permissions", "中国地府 · 规制司"],
  ["/judgment", "中国地府 · 刑名司"],
] as const) {
  test(`${path} 的殿名是「${hall}」`, async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto(path);
    await expect(page.getByTestId("plaque").locator(".identity-court")).toHaveText(hall);
  });
}
