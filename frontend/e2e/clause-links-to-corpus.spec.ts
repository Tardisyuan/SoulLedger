import { expect, test, setupAuthenticatedPage, SOULS, SOUL_LEDGER, STATUTES } from "./fixtures";

/**
 * 功过记录的条款号链到语料页的那一条(`/corpus?code=<Statute.code>`,用户 2026-10-02):
 * 灵魂详情台账点条款 → 语料页打开那一条、目录展开它那一部;编号不在语料里就写明,从第一条读起。
 */
const TARGET = STATUTES[1]; // INFERNO-26 —— 不是目录的第一部,落到它才说明是链接选的。
const RECORD = {
  id: "11111111-1111-4111-8111-111111111112", type: "DEMERIT", category: "BETRAYAL", description: "出卖恩主",
  original_weight: 300, effective_weight: 300, years_elapsed: 0, decay_factor: 1, civilization: "EUROPEAN",
  recorded_at: "2026-06-02T00:00:00Z", event_date: null, is_milestone: false, occurrence_count: null,
  statute_clause: `${TARGET.code}:Those who betrayed their lords`,
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("a ledger clause opens its article in the corpus, with its group expanded", async ({ page }) => {
  const api = await setupAuthenticatedPage(page);
  api.on("GET", "/souls/:id/karma/", { ...SOUL_LEDGER, record_count: 1, records: [RECORD] });
  await page.goto(`/souls/${SOULS[0].id}`);
  await page.getByRole("tab", { name: /全部功过记录/ }).click();

  const link = page.locator('[data-record-clause="column"]');
  await expect(link).toHaveAttribute("title", RECORD.statute_clause);
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/corpus\\?code=${TARGET.code}$`));
  await expect(page.getByTestId("corpus-reading")).toContainText(TARGET.display_title);
  const toc = page.getByRole("navigation", { name: "目录" });
  await expect(toc.locator('[data-toc-corpus="INFERNO"] > button')).toHaveAttribute("aria-expanded", "true");
  await expect(toc.locator('[aria-current="true"]')).toContainText(TARGET.display_title);
  await expect(toc.locator('[data-toc-corpus="GONGGUOGE"] > button')).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("corpus-unknown-code")).toHaveCount(0);
});

test("an unknown code says so and reads from the first article", async ({ page }) => {
  await setupAuthenticatedPage(page);
  await page.goto("/corpus?code=NOPE-404");
  await expect(page.getByTestId("corpus-unknown-code")).toContainText("NOPE-404");
  await expect(page.getByTestId("corpus-reading")).toContainText(STATUTES[0].display_title);
});
