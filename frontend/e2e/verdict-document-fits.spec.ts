/**
 * 判决文书排得进一页(2026-11-07 真 Gotenberg PDF 上看到的三处):
 *   · 地府竖排的落款与日期在最左一列,正文区 `overflow: hidden` 把它们静默裁掉 —— PDF 上没有落款、没有日期;
 *   · 地府英文界面的印文被竖写,逐个字母立起来,出了印框又出了纸;
 *   · 欧洲火漆打印时去了底色,只剩一道细圈,印文出圈。
 * jsdom 不排版,这些只能在真浏览器里量:正文区 scrollWidth / scrollHeight 不超过 clientWidth / clientHeight,
 * 落款、日期落在正文区里面,印文的字落在印里面。屏幕上的卡与打印的那一份(点「打印」挂到 body 下)都量。
 */
import { expect, test, OPENED_JUDGMENT, setupAuthenticatedPage } from "./fixtures";
import type { Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3333";

/** 地府「不过」不选罪目时,判语里的罪由判官写的说明代入 —— 文书上最长的一种。 */
const LONG_NOTE =
  "生前贩卖假药，致乡里病者三人身亡；又以高利盘剥邻里，逼死佃户一家；侵占族中祭田，篡改契据，欺瞒官府；" +
  "临终不悔，反诬他人。数罪并发，证据确凿，本殿查核生死簿、业镜所照，与原告所诉一一相符。";

const FINAL = {
  ...OPENED_JUDGMENT,
  is_final: true,
  concluded_at: "2026-11-07T01:00:00Z",
  concluded_at_local: "2026-11-07T09:00:00+08:00",
  judge_name: "秦广王",
  merit_score: 12,
  demerit_score: 340,
  fail_reasons: [],
  fail_reason_note: "",
  offence: "",
  cited_deadly_sins: [],
};

const CASES: { name: string; locale: string; judgment: Record<string, unknown> }[] = [
  { name: "地府 · 竖排 · 长案情", locale: "zh-Hans", judgment: { civilization: "CHINESE", verdict: "FAILED", court: "第一殿", fail_reason_note: LONG_NOTE } },
  { name: "地府 · 竖排 · 五逆", locale: "zh-Hans", judgment: { civilization: "CHINESE", verdict: "FAILED", court: "第一殿", offence: "FIVE_HEINOUS" } },
  { name: "地府 · 英文", locale: "en", judgment: { civilization: "CHINESE", verdict: "FAILED", court: "第十殿", fail_reason_note: LONG_NOTE } },
  { name: "地府 · egy", locale: "egy", judgment: { civilization: "CHINESE", verdict: "PASSED", court: "第十殿" } },
  { name: "欧洲 · 炼狱", locale: "zh-Hans", judgment: { civilization: "EUROPEAN", verdict: "PURGATORY", court: "炼狱", cited_deadly_sins: ["pride", "envy", "wrath", "greed", "lust"] } },
  { name: "欧洲 · 英文", locale: "en", judgment: { civilization: "EUROPEAN", verdict: "FAILED", court: "炼狱" } },
  { name: "埃及", locale: "zh-Hans", judgment: { civilization: "EGYPTIAN", verdict: "PASSED", court: "两真之殿" } },
  { name: "希腊", locale: "zh-Hans", judgment: { civilization: "GREEK", verdict: "FAILED", court: "岔路口草地", greek_account: "GORGIAS", greek_curability: "INCURABLE" } },
];

/** 一张纸上的量法:返回不合格的项,空数组即排得下。 */
async function misfits(page: Page, paper: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.locator(paper).evaluate((root) => {
    const bad: string[] = [];
    const text = root.querySelector<HTMLElement>("[data-doc-text]")!;
    if (text.scrollWidth > text.clientWidth + 1) bad.push(`正文区横向溢出 ${text.scrollWidth} > ${text.clientWidth}`);
    if (text.scrollHeight > text.clientHeight + 1) bad.push(`正文区纵向溢出 ${text.scrollHeight} > ${text.clientHeight}`);
    const box = text.getBoundingClientRect();
    const inside = (r: DOMRect, o: DOMRect) => r.left >= o.left - 1 && r.right <= o.right + 1 && r.top >= o.top - 1 && r.bottom <= o.bottom + 1;
    for (const sel of ["[data-doc-date]", "[data-doc-sign] p", "[data-doc-verdict]"]) {
      for (const el of root.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !inside(r, box)) bad.push(`${sel}「${el.textContent}」不在正文区里`);
      }
    }
    const seal = root.querySelector<HTMLElement>("[data-doc-seal]")!;
    const ink = document.createRange();
    ink.selectNodeContents(seal.querySelector("span")!);
    if (!inside(ink.getBoundingClientRect(), seal.getBoundingClientRect())) bad.push(`印文「${seal.textContent}」出了印`);
    if (!inside(seal.getBoundingClientRect(), root.getBoundingClientRect())) bad.push("印出了纸");
    return bad;
  });
}

test.describe("判决文书排得进一页", () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      // 「打印」会调 window.print();真浏览器里它弹对话框,这里只要它把打印那一份挂上。
      await page.addInitScript(() => {
        window.print = () => undefined;
      });
      const api = await setupAuthenticatedPage(page);
      await page.context().addCookies([{ name: "soulledger-locale", value: c.locale, url: BASE_URL }]);
      api.on("GET", "/judgment/:id/", { ...FINAL, ...c.judgment });
      await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);

      const card = "[data-verdict-doc] [data-verdict-paper]";
      await expect(page.locator(card)).toBeVisible();
      expect(await misfits(page, card)).toEqual([]);

      await page.locator("[data-verdict-doc-actions] button").nth(1).click();
      await page.emulateMedia({ media: "print" });
      const sheet = "[data-print-verdict-doc] [data-verdict-paper]";
      await expect(page.locator(sheet)).toBeVisible();
      expect(await misfits(page, sheet)).toEqual([]);
      // 纸色照印;欧洲火漆照印(不是一道细圈)。
      const paint = await page.locator(sheet).evaluate((root) => ({
        paper: getComputedStyle(root).backgroundColor,
        wax: getComputedStyle(root.querySelector("[data-doc-seal]")!).backgroundImage,
      }));
      expect(paint.paper).not.toBe("rgba(0, 0, 0, 0)");
      if (c.judgment.civilization === "EUROPEAN") expect(paint.wax).toContain("radial-gradient");
    });
  }
});
