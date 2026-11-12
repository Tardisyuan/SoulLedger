/**
 * 393 px 下领域列表页的两个缺陷(v3/pages-b,2026-10-02):
 *
 * 1. 自动布局的表把中文名挤到 min-content —— 一字一行(/souls 的「孟婆的第一位客人」竖成
 *    八行,/dispatch 同样)。修法是名字等格不折行,表在自己的 `overflow-x-auto` 里横滚;
 *    文档本身不变宽(`no-route-overflows-the-document` 管那一条)。
 * 2. 分页的「← 上一页」「下一页 →」折成三行,整条控件变高。窄屏只留箭头,文字给读屏。
 *
 * 量的是高度:一行 13 px 字的链接不到 30 px 高,折成两行就过了。
 */
import { expect, test, setupAuthenticatedPage, SOULS, PROPOSED_DISPATCH } from "./fixtures";

const ONE_LINE = 30;

for (const [path, name] of [
  ["/souls", SOULS[0].name],
  ["/dispatch", SOULS[0].name],
] as const) {
  test(`${path} 在 393 px 下名字一行、分页一行`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 900 });
    await setupAuthenticatedPage(page);
    await page.goto(path);
    const link = page.getByRole("link", { name, exact: true }).first();
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.height, `${path}: 名字链接高 ${box!.height}px —— 折行了`).toBeLessThan(ONE_LINE);

    // 按钮是定高 44(v3 sm 档),折行的字溢出框外而框不长 —— 所以量内容高(scrollHeight),
    // 不量框;计数那一句量自己的框。
    const prev = page.getByRole("button", { name: /上一页/ }).first();
    const overflow = await prev.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, `${path}: 「上一页」的字溢出按钮 ${overflow}px —— 折行了`).toBeLessThanOrEqual(1);
    const info = page.getByText(/第\s*1\s*\/\s*1\s*页/).first();
    const infoBox = await info.boundingBox();
    expect(infoBox!.height, `${path}: 分页计数高 ${infoBox!.height}px —— 折行了`).toBeLessThan(ONE_LINE);
  });
}

/**
 * 殿名:这三页经 `usePlaque` 报殿名,第三十批「卷宗」起写在页头标题上方那一行等宽小字里;
 * 一页只有一个页头、一个 `<h1>`(身份带与它的第二个标题撤掉了)。
 */
for (const [path, hall] of [
  ["/dispatch/propose", "酆都 · 第十殿"],
  [`/dispatch/${PROPOSED_DISPATCH.id}`, "酆都 · 第十殿"],
  ["/soul-inbox", "酆都 · 第十殿"],
] as const) {
  test(`${path} 的页头写「${hall}」`, async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto(path);
    const head = page.getByTestId("page-head");
    await expect(head.locator("[data-page-shell-eyebrow]")).toHaveText(new RegExp(`^${hall}( · |$)`));
    await expect(head).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
  });
}
