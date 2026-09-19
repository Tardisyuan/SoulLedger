import { test, expect, setupAuthenticatedPage, SENTENCE_PLAN, SOULS } from "./fixtures";

/**
 * 受刑计划的 Web 端(docs/ARCHITECTURE-sentence-plan.md §9 阶段 4),对着路由 mock、以 ADMIN
 * (fixtures.ts TEST_USER,租户 CN_DIYU = 这份计划的原属)。
 * 「非原属看不到批准按钮」「没有 judgment.execute 看不到按钮」要换角色 / 租户,钉在 jest
 * (SentencePlanPanels.test.tsx)。
 */

test.describe("Sentence plan", () => {
  test("the soul page shows every stop and which one the soul is at", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto(`/souls/${SOULS[0].id}`);

    const card = page.getByTestId("sentence-plan-card");
    await expect(card.getByRole("heading", { name: "受刑计划" })).toBeVisible();
    const stops = card.locator("li[data-node-order]");
    await expect(stops).toHaveCount(3);
    await expect(stops.nth(0)).toContainText("已完成");
    await expect(stops.nth(1)).toContainText("受刑中");
    await expect(stops.nth(1)).toHaveAttribute("aria-current", "step");
    await expect(card.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(stops.nth(2)).toContainText("未开始");
    await expect(card.getByText("执行中")).toBeVisible();
    // 待决定的请求在面板里也看得到,原属(ADMIN)有批准按钮。
    await expect(card.locator(`li[data-request-id="${SENTENCE_PLAN.requests[0].id}"]`)).toContainText("减去第 3 站");
  });

  test("the original judge accepts a pending request from the inbox", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/sentence-requests");

    await expect(page.locator("h1")).toContainText("受刑请求");
    const row = page.locator(`li[data-plan-id="${SENTENCE_PLAN.id}"]`);
    await expect(row).toContainText(SENTENCE_PLAN.soul_name);
    await expect(row).toContainText("减去第 3 站");
    await expect(row).toContainText("炼狱一站已由另案抵偿");

    await row.getByRole("button", { name: "批准" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("已开始的站不受影响");
    await dialog.getByLabel("理由（可选，提出方看得到）").fill("同意");
    await dialog.getByRole("button", { name: "批准" }).click();

    await expect
      .poll(() => api.lastCall("POST", "/sentence-plans/:id/requests/:id/decide/")?.body)
      .toEqual({ decision: "ACCEPT", reason: "同意" });
    expect(api.lastCall("POST", "/sentence-plans/:id/requests/:id/decide/")?.path).toBe(
      `/sentence-plans/${SENTENCE_PLAN.id}/requests/${SENTENCE_PLAN.requests[0].id}/decide/`
    );
    await expect(dialog).toBeHidden();
  });
});
