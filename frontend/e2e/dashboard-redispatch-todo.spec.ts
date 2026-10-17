/**
 * 仪表盘待办条的第四格「待重发的调拨」(`GET /sentence-plans/?awaiting_redispatch=true`)。
 *
 * 有被拒 / 取消后等着重发的计划:显示数字与「去处理 →」,点了落到受刑计划列表、按同一条件筛好
 * (审计 1017 #8:不再只落到第一份计划的灵魂,数量大于 1 时其余的也找得到)。没有:这一格照另外三格的约定 —— 照常写 0、不隐藏、右侧是「✓ 已清空」、
 * 没有链接、没有「待我处理」竖条。
 */
import { expect, test, SENTENCE_PLAN, setupAuthenticatedPage } from "./fixtures";

const CELL = '[data-todo]:has-text("待重发的调拨")';

test.describe("dashboard todo strip — dispatches awaiting a resend", () => {
  test("shows the count and an entry that lands on the plan list, filtered the same way", async ({ page }) => {
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
    await expect(link).toHaveAttribute("href", "/sentence-plans?awaiting_redispatch=true");

    await link.click();
    await expect(page).toHaveURL(/\/sentence-plans\?awaiting_redispatch=true$/);
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

  test("at 393px the cells sit two to a row, left-to-right then top-to-bottom, without overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/sentence-plans/", (call) =>
      call.query.awaiting_redispatch === "true"
        ? { body: { count: 12345, next: null, previous: null, results: [SENTENCE_PLAN] } }
        : { body: { count: 1, next: null, previous: null, results: [SENTENCE_PLAN] } }
    );

    await page.goto("/dashboard");
    // 审计 1017 #7 之后管理员看得到全部十一格;这里看前四格的排法,与每一格都不溢出。
    const cells = page.locator("[data-todo]");
    await expect(cells).toHaveCount(11);
    await expect(page.locator(CELL).locator("[data-todo-count]")).toHaveText("12 345");
    const boxes = await cells.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        // Everything inside a cell must stay inside it: nothing clipped, nothing spilling into the neighbour.
        const spill = [...el.querySelectorAll("*")].some((c) => {
          const cr = c.getBoundingClientRect();
          return cr.width > 0 && (cr.left < r.left - 0.5 || cr.right > r.right + 0.5);
        });
        return { x: r.x, y: r.y, w: r.width, spill, clipped: el.scrollWidth > el.clientWidth };
      })
    );
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + 100);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y + 40);
    expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThan(1);
    expect(boxes[3].x).toBeGreaterThan(boxes[2].x + 100);
    expect(boxes.filter((b) => b.spill)).toEqual([]);
    expect(boxes.filter((b) => b.clipped)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
