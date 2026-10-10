/**
 * 仪表盘待办条的第四格「待重新发起的调拨」(`GET /sentence-plans/?awaiting_redispatch=true`)。
 *
 * 有被拒 / 取消后等着重发的计划:显示数字与「去处理 →」,点了落到第一份计划的灵魂详情
 * (受刑计划卡在那里)。没有:这一格照另外三格的约定 —— 照常写 0、不隐藏、右侧是「✓ 已清空」、
 * 没有链接、没有「待我处理」竖条。
 */
import { expect, test, SENTENCE_PLAN, SOULS, setupAuthenticatedPage } from "./fixtures";

const CELL = '[data-todo]:has-text("待重新发起的调拨")';

test.describe("dashboard todo strip — dispatches awaiting a resend", () => {
  test("shows the count and an entry that lands on the soul's plan card", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/sentence-plans/", (call) =>
      call.query.awaiting_redispatch === "true"
        ? { body: { count: 2, next: null, previous: null, results: [SENTENCE_PLAN, { ...SENTENCE_PLAN, id: "p2", soul: "other" }] } }
        : { body: { count: 1, next: null, previous: null, results: [SENTENCE_PLAN] } }
    );

    await page.goto("/dashboard");
    const cell = page.locator(CELL);
    await expect(cell.locator("[data-todo-count]")).toHaveText("2");
    await expect(cell).toHaveAttribute("data-todo-mine", "");
    const link = cell.getByRole("link", { name: "去处理 →" });
    await expect(link).toHaveAttribute("href", `/souls/${SOULS[0].id}`);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/souls/${SOULS[0].id}$`));
    await expect(page.getByTestId("sentence-plan-card")).toBeVisible();
  });

  test("with nothing waiting it reads 0 and 已清空, like the other cells", async ({ page }) => {
    await setupAuthenticatedPage(page);

    await page.goto("/dashboard");
    const cell = page.locator(CELL);
    await expect(cell.locator("[data-todo-count]")).toHaveText("0");
    await expect(cell).toContainText("已清空");
    await expect(cell).not.toHaveAttribute("data-todo-mine", "");
    await expect(cell.getByRole("link")).toHaveCount(0);
  });
});
