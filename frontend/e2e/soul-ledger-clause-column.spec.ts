import { expect, test, setupAuthenticatedPage, SOULS, SOUL_LEDGER } from "./fixtures";

/**
 * 灵魂详情的功过台账:条款是自己的一列(Design v3 功过记录,用户 2026-10-02),窄屏(< 768)
 * 没有这一列,条款折回事目的第二行。jsdom 不排版,所以「哪一边真的看得见」只能在浏览器里问 ——
 * 尤其是 `<col>` 上的 `display: none`:列宽表若还留着那一格,窄屏的事目会被挤掉 112px。
 */
const RECORD = {
  id: "11111111-1111-4111-8111-111111111111", type: "MERIT", category: "CHARITY", description: "洪水中协助转移邻里",
  original_weight: 120, effective_weight: 120, years_elapsed: 0, decay_factor: 1, civilization: "CHINESE",
  recorded_at: "2026-06-02T00:00:00Z", event_date: null, is_milestone: true, occurrence_count: 1,
  statute_clause: "救濟門#7:賑濟窮民百錢",
};

for (const [w, h, column] of [[1440, 900, true], [393, 852, false]] as const) {
  test(`at ${w} the clause is ${column ? "its own column" : "folded under the entry"}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const api = await setupAuthenticatedPage(page);
    api.on("GET", "/souls/:id/karma/", { ...SOUL_LEDGER, record_count: 1, records: [RECORD] });
    await page.goto(`/souls/${SOULS[0].id}`);
    await page.getByRole("tab", { name: /全部功过记录/ }).click();

    const book = page.locator("table").filter({ has: page.locator("[data-record-clause]") });
    await expect(book.locator('[data-record-clause="column"]')).toBeVisible({ visible: column });
    await expect(book.locator('[data-record-clause="folded"]')).toBeVisible({ visible: !column });
    await expect(book.getByRole("columnheader", { name: "条款" })).toBeVisible({ visible: column });

    // At 1440 all seven columns fit the page's ~604px middle column — 销算余 is not scrolled
    // out of sight — and on a phone the hidden column gives its 96px back to 事目 (600 − 396).
    const [table, scroller] = await book.evaluate((t) => [t.scrollWidth, t.parentElement!.clientWidth]);
    if (column) expect(table, "the book is wider than its column").toBeLessThanOrEqual(scroller);
    const item = (await book.locator("tbody td").nth(2).boundingBox())!.width;
    expect(item).toBeGreaterThanOrEqual(column ? 100 : 200);

    // 「◆ 重要节点」 is one line: the glyph never ends a line by itself.
    const unit = book.locator("[data-record-facts] .whitespace-nowrap", { hasText: "重要节点" });
    expect(await unit.evaluate((el) => el.getClientRects().length)).toBe(1);
  });
}
