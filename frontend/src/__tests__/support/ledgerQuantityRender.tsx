/**
 * The render half of the ledger quantity contract's shared machinery: the two
 * components under test, wrapped in the real `I18nProvider`, plus the DOM
 * inventory the assertions compare against.
 *
 * The real provider is used, not a `t: (key) => key` stub: a stub that echoes
 * keys makes every copy assertion pass against a bundle with no copy in it.
 *
 * Not named `*.test.tsx` on purpose: `suiteShape.test.ts` walks this directory
 * for `/\.test\.tsx?$/` and requires every match to be registered by name.
 *
 * NOTE for anyone importing this: the caller must declare
 * `jest.mock("@/src/components/charts/LazyDashboardCharts", ...)` itself.
 * `jest.mock` is hoisted per test file and does not travel through an import.
 */
import { render } from "@testing-library/react";

import type { LedgerInheritance, LedgerReading } from "@/lib/api/ledger";
import type { QueueLedger } from "@/lib/api/judgment";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { LedgerPanel } from "@/src/components/judgment/JudgmentQueueContext";
import { SoulKarmaLedgerCard } from "@/src/components/souls/SoulKarmaLedgerCard";

import { RECORDS } from "./ledgerQuantityFixtures";

export function renderCard(reading: LedgerReading, inheritance: LedgerInheritance | null) {
  return render(
    <I18nProvider>
      <SoulKarmaLedgerCard
        ledgerLabel="业力总账"
        reading={reading}
        meritScore={24}
        demeritScore={9}
        karmicBalance={15}
        recordCount={RECORDS.length}
        records={RECORDS}
        inheritance={inheritance}
      />
    </I18nProvider>
  );
}

export function renderQueueLedger(ledger: QueueLedger) {
  return render(
    <I18nProvider>
      <LedgerPanel ledger={ledger} />
    </I18nProvider>
  );
}

/** One rendered figure, as this contract compares them. */
export interface Figure {
  field: string;
  quantity: string;
  text: string;
  /** Does this figure name the scale it is measured on? */
  scaled: boolean;
}

/**
 * The marker is looked up as a *sibling* of the numeral rather than by field
 * name across the whole tree, which is where this differs from
 * `readingQuantityContract`'s helper. These two components can draw the same
 * field twice on one screen — an UNAVAILABLE reading prints the summary's three
 * sums and the card beneath it prints them again — and a document-wide lookup
 * would answer for the wrong one of the pair.
 */
export function figures(root: HTMLElement): Figure[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-quantity]")).map((el) => {
    const mark = el.parentElement?.querySelector<HTMLElement>("[data-quantity-scale]") ?? null;
    return {
      field: el.dataset.quantityField ?? "",
      quantity: el.dataset.quantity ?? "",
      text: (el.textContent ?? "").trim(),
      scaled: mark !== null && (mark.textContent ?? "").trim() !== "",
    };
  });
}

/** The sizes these components draw a figure at. */
// Both scales, deliberately.
//
// `text-lg|xl|2xl|3xl` + `font-bold` is what a headline figure looked like
// before Stage 11. `text-06|07|08` is what it looks like after — and those
// three carry `fontWeight: 600` in `tailwind.config.js`'s fontSize table, so a
// migrated figure needs no separate weight class and would not match a
// `font-bold` requirement at all.
//
// Matching only the old names would leave this selector blind at exactly the
// moment the component it watches gets migrated: the scan would find nothing,
// `unclassifiedHeadlines` would return `[]`, and "no unclassified headline"
// would pass over a card it never looked at. That is why the floor below is
// asserted separately — and why the floor alone is not enough if the selector
// itself can go stale.
//
// 迁移完成后这条注释里的「287 处」已是历史:`src/components/` 下的旧档现在是 0。
// 两档并列的写法要留着 —— 见下面 DIGITS 那段。
const FIGURE_SIZE = /(^|\s)(text-(lg|xl|2xl|3xl)|text-0[678])(\s|$)/;
const BOLD = /(^|\s)(font-bold|text-0[678])(\s|$)/;

// 尺寸与字重合起来说的是「这东西画得像个头条」,**不是**「这东西是个数字」。
// 八档字号把这两件事彻底分开了:`text-06` 在 tailwind.config.js 里是**区块/面板
// 标题**那一档(22px,自带 600),而它同时落在上面两个正则里。于是每有一个面板标题
// 被**正确地**迁到 text-06,这个数字契约就白收进一个非数字 —— 遵守设计系统本身
// 就会把标题走进来,这不是迁移期残留,是随迁移推进而增长的。
//
// 三个 agent 各自独立撞出同一形状,合计 10 处冒名者:两个对话框标题、一个关闭 `×`、
// 三个 <h1>、两个 <h2>、一个区块标题,外加两个纯装饰字形 —— PageError 的 `!` 与
// PermissionDenied 的 🔒。后两个尤其能说明问题:它们原本是 text-6xl,而 FIGURE_SIZE
// 只列到 3xl,所以它们本来在 band 外,是迁到 text-08 之后**走进来的**。
// 若有东西渲染它们,这个契约会报出一条 textContent 为「🔒」的「未分类头条数字」。
//
// 为什么判据不是「收窄到 text-07/08」:🔒 和 `!` 都是 text-08,收窄一个都拦不住。
// 尺寸永远分不开「一个大数字」和「一个大字形」。
//
// 为什么判据**也不是**「有 data-quantity 才算」—— 这是三个 agent 都提的方向,而它
// 会把这个检查变成空转。unclassifiedHeadlines 的违规定义就是**缺**这个属性;拿它
// 当入选条件,过滤器就恒为空,永远抓不到任何东西。那不是补上漏检,是换成一个
// 什么都不看的检查 —— 本仓已经记了八次的同一个失败形状。
//
// 判据是**里面有没有阿拉伯数字**。头条数值有,标题和装饰字形没有。
// 或上 data-quantity-absent:声明为「无值」的格子画的是「—」,没有数字,但它必须
// 留在主体集合里,否则 FIGURE_FLOOR 会因为一个格子恰好无值而被判成没渲染。
// 这一条只**放宽**入选,不收紧:带数字而未声明的元素照样在集合里,照样被抓。
const DIGITS = /\d/;

/**
 * Every slot drawn at figure size and weight — classified or not.
 *
 * Exported because `unclassifiedHeadlines` is a scan for offenders, and a scan
 * for offenders is clean when it scans nothing. The subject set has to be
 * floored separately or "no unclassified headline" would go on passing over a
 * card that drew no headlines at all.
 */
export function figureSlots(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) => {
    const cls = el.className.toString();
    if (!BOLD.test(cls) || !FIGURE_SIZE.test(cls)) return false;
    return DIGITS.test(el.textContent ?? "") || el.hasAttribute("data-quantity-absent");
  });
}

export function unclassifiedHeadlines(container: HTMLElement): string[] {
  return figureSlots(container)
    .filter((el) => !el.hasAttribute("data-quantity") && !el.hasAttribute("data-quantity-absent"))
    .map((el) => (el.textContent ?? "").trim());
}
