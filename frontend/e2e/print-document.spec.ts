/**
 * 打印(Design 第十五批 C1,第十九批修正):判词页与灵魂档案在**打印媒体**下是一份文书,不是屏幕的截图。
 *
 * jsdom 不排版也不做媒体查询,所以「打印时哪些东西不见了」只能在真浏览器里量:
 * `page.emulateMedia({ media: "print" })`。要点(都来自主会话用打印媒体截图看到的缺陷):
 *   · 裁决键、操作提示、返回链接、「写评议」的标签、装饰图形 —— 交互与导航,不印;
 *   · 评议全部印出来,并带「评议 · N」标题(屏幕上只露最近 3 条,「展开其余」在纸上没有);
 *   · 页脚:判词印案号;灵魂档案印这一世账号的灵魂编号,没有账号就印灵魂名,永不印 UUID。
 */
import { expect, test, OPENED_JUDGMENT, SOULS, setupAuthenticatedPage } from "./fixtures";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const comments = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  author_name: `官员${i + 1}`,
  body: `第 ${i + 1} 条评议`,
  created_at: `2026-10-0${i + 1}T01:00:00Z`,
}));

test.describe("print media", () => {
  test("a judgment prints as a document: no keys, no navigation, every comment under its title, the case number in the footer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/judgment/:id/comments/", comments);
    await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);
    await page.waitForLoadState("networkidle");

    // On screen the keys, the hint and the back link are all there -- so the hiding below is the print rules' doing.
    await expect(page.getByTestId("verdict-bar")).toBeVisible();
    await expect(page.getByText("按数字键 1–4 选择判决")).toBeVisible();
    await expect(page.getByRole("link", { name: /返回审判列表/ })).toBeVisible();
    await expect(page.getByTestId("comment-1")).toHaveCount(0); // only the latest three

    await page.emulateMedia({ media: "print" });

    await expect(page.getByTestId("comment-1")).toBeVisible(); // printing renders them all
    for (const n of [1, 2, 3, 4, 5]) await expect(page.getByTestId(`comment-${n}`)).toBeVisible();
    await expect(page.getByText("评议 · 5")).toBeVisible();
    await expect(page.getByTestId("comments-show-rest")).toHaveCount(0);

    await expect(page.getByTestId("verdict-bar")).toBeHidden();
    await expect(page.getByText("按数字键 1–4 选择判决")).toBeHidden();
    await expect(page.getByText("落判不可撤回")).toBeHidden();
    await expect(page.getByText("发起审批流程")).toBeHidden();
    await expect(page.getByText("写评议")).toBeHidden(); // the label of the (hidden) input
    await expect(page.getByRole("link", { name: /返回审判列表/ })).toBeHidden();
    await expect(page.getByTestId("civ-motif")).toBeHidden();

    // The document itself stays: ruling, the soul's facts, header and footer.
    await expect(page.getByTestId("current-ruling")).toBeVisible();
    await expect(page.locator("[data-print-reference]")).toHaveText("案号 CN-2026-0001");
    await expect(page.locator("[data-print-hall]")).not.toBeEmpty();

    // Back on screen the keys return and the comments fold back to three.
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByTestId("verdict-bar")).toBeVisible();
    await expect(page.getByTestId("comment-1")).toHaveCount(0);
  });

  test("a soul's file prints without its buttons and links, with the plan card in one piece, and never a UUID in the footer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupAuthenticatedPage(page);
    await page.goto(`/souls/${SOULS[0].id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: /返回灵魂列表/ })).toBeVisible();
    await expect(page.getByText("含系统事件")).toBeVisible();
    await expect(page.getByRole("link", { name: "查看待交付列表" })).toBeVisible();

    await page.emulateMedia({ media: "print" });

    await expect(page.getByRole("link", { name: /返回灵魂列表/ })).toBeHidden();
    await expect(page.getByRole("heading", { name: "操作" })).toBeHidden();
    await expect(page.getByText("含系统事件")).toBeHidden();
    await expect(page.getByRole("link", { name: "查看待交付列表" })).toBeHidden();
    await expect(page.getByRole("link", { name: "查看" })).toHaveCount(0);

    // Content that is the document stays: the identity column and the plan card.
    await expect(page.getByText("灵魂账号")).toBeVisible();
    const card = page.getByTestId("sentence-plan-card");
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");

    const foot = await page.locator("[data-print-foot]").evaluate((el) => (el as HTMLElement).innerText ?? el.textContent);
    expect(foot ?? "").not.toMatch(UUID);
    // 页脚认得出是谁的档案:夹具里该灵魂有当前账号,印它的灵魂编号。
    await expect(page.locator("[data-print-reference]")).not.toBeEmpty();
    await expect(page.locator("[data-print-reference]")).toContainText("MPK 7Q2R X9T");
  });
});
