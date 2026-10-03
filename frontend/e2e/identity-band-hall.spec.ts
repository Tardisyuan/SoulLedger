/**
 * 身份带殿名「<冥界名> · <司 / 殿>」(用户 2026-10-02):每页写一个固定的司名,审判类页面写
 * 眼前这一案的殿。前缀是文明的冥界名,不是租户展示名:fixtures 的租户是 CN_DIYU「中国地府」,
 * 带上写「酆都」。各取一页代表四个司:
 * 概览 → 第十殿(Design A4)、语料 → 典籍司(A3)、权限 → 规制司(A1/A2 同司)、审判列表 → 刑名司。
 */
import { expect, test, setupAuthenticatedPage } from "./fixtures";

for (const [path, hall] of [
  ["/dashboard", "酆都 · 第十殿"],
  ["/corpus", "酆都 · 典籍司"],
  ["/permissions", "酆都 · 规制司"],
  ["/judgment", "酆都 · 刑名司"],
] as const) {
  test(`${path} 的殿名是「${hall}」`, async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto(path);
    await expect(page.getByTestId("plaque").locator(".identity-court")).toHaveText(hall);
  });
}
