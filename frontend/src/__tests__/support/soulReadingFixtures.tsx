/**
 * Shared fixtures for the four suites that render `SoulReadingPanel`.
 *
 * The panel's tests were one 951-line file until they were split by subject —
 * the poena bullets and the exhaustiveness guarantee, the Greek sentence, the
 * fork's geometry, and the copy coverage across bundles. Everything four of
 * them need to agree on lives here, once, so a payload shape cannot drift
 * between the suite that renders it and the suite that asserts about it.
 *
 * Two things this file deliberately does NOT provide:
 *
 *   * a `t: (key) => key` stub. Every render below goes through the real
 *     `I18nProvider`, because a stub that echoes the key makes every copy
 *     assertion pass against a bundle with no copy in it — the shape of test
 *     double `WorkflowPage.test.tsx` was caught with, where the double
 *     reproduced the defect under test and then measured itself.
 *   * any helper that selects an element by its type-scale class. Most of
 *     `src/components/**` is still on the old scale (`text-xs`/`text-sm`/
 *     `text-lg`) while `app/**` has migrated; a helper that knew only one of
 *     the two would go blind at precisely the moment these components are
 *     migrated, which is the worst possible moment for a guard to stop
 *     looking. The suites assert on classes inline, where the class being
 *     asserted is visible next to the assertion.
 */
import { render } from "@testing-library/react";

import {
  SENTENCE_MISSING_INPUTS,
  type LedgerReading,
  type PoenaMissingInput,
} from "@soulledger/core/api/ledger";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";

/**
 * The floor under a traversal, stated as the number that was actually
 * measured rather than one that seemed safe.
 *
 * Eight times on this codebase a split test file went green by scanning
 * nothing: an anchor that no longer matched, a filter that skipped every
 * element, a member list that could legally be empty. The failure mode is not
 * an error, it is a passing test that asserted about zero things — and the
 * most recent instance shipped three lower bounds (`>= 8`, `>= 5`, `>= 3`)
 * that were invented at the keyboard for a card which draws 4, 3 and 1 slots.
 *
 * So: every `floor` passed to this function is a number that was printed by a
 * probe run against the real component, and the message says how far the
 * scanner actually got, so a red here reads as "the scanner went blind"
 * rather than "the component changed".
 */
export function assertScanned(label: string, count: number, floor: number): void {
  if (count < floor) {
    throw new Error(
      `${label}: the scan reached ${count} item(s), and the measured floor is ${floor}. ` +
        `A traversal over nothing is a green assertion about nothing.`
    );
  }
}

/** The provider's default locale, so these are the strings that render. */
export const ZH = {
  absolution: "是否已获赦免",
  satisfaction: "应偿补赎多少",
  penance: "已行补赎多少",
  unavailableExplanation:
    "该灵魂所属租户尚未映射到任何文明宇宙观，因此没有可呈现的解读——仅显示下方原始账目。",
  unavailableCta: "请为该租户配置文明映射以启用解读。",
  // The tenfold rule now sits at the apex of the fork, stated once for both
  // roads, so neither road's caption carries the multiple any more.
  repaymentRule: "每桩皆以 10 倍偿还——两道同此一律",
  owedLabel: "所欠刑期",
  owedDetail: "桩在案过错",
  requitedLabel: "所得回报",
  requitedDetail: "桩在案善行 · 不冲抵刑期",
  circuit: "以 1000 年为一个周期计量——这是偿还的单位，不是本刑期的长度。",
  elapsedLabel: "已服",
  poenaHeading: "无法计算",
  elapsedHeading: "本账本未记",
  termStart: "刑期何时开始",
  timeServed: "已服了多少",
  /** `sentence_elapsed_years` interpolated. A unit, not a bare number: "2424"
   *  under a label reading 已服 states no unit, and years are the only thing a
   *  term is measured in here. */
  elapsedYears: (years: number) => `${years} 年`,
};

export function renderPanel(reading: LedgerReading) {
  return render(
    <I18nProvider>
      <SoulReadingPanel reading={reading} meritScore={30} demeritScore={12} karmicBalance={18} />
    </I18nProvider>
  );
}

export function guiltAndPenalty(poenaMissing: PoenaMissingInput[]): LedgerReading {
  return {
    kind: "GUILT_AND_PENALTY",
    civilization: "EUROPEAN",
    culpa: 12,
    culpa_record_count: 2,
    poena: null,
    poena_missing: poenaMissing,
  };
}

export function sentence(
  overrides: Partial<Extract<LedgerReading, { kind: "SENTENCE" }>> = {}
): LedgerReading {
  return {
    kind: "SENTENCE",
    civilization: "GREEK",
    wrongs: 4,
    // Deliberately different from `wrongs`: every assertion that looks up a
    // figure by its text would be ambiguous if the two roads carried the same
    // number, and the arithmetic guard needs the difference (1), the sum (7)
    // and the products (40, 30, 12) to be distinct from both.
    benefactions: 3,
    repayment_multiple: 10,
    circuit_years: 1000,
    elapsed_years: null,
    elapsed_missing: [...SENTENCE_MISSING_INPUTS],
    ...overrides,
  };
}

export function bulletTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("li")).map((li) => li.textContent ?? "");
}

/**
 * The bare em-dash spans in the panel, having first proved there were spans to
 * look through.
 *
 * Every caller that asserts `toHaveLength(0)` here is asserting an absence,
 * and an absence is exactly what a blind selector reports. `minSpansScanned`
 * is the measured span count for the payload being rendered, so a selector
 * that stopped matching fails loudly instead of certifying the glyph is gone.
 */
export function dashSpans(container: HTMLElement, minSpansScanned: number): HTMLSpanElement[] {
  const spans = Array.from(container.querySelectorAll("span"));
  assertScanned("em-dash scan over the panel's spans", spans.length, minSpansScanned);
  return spans.filter((el) => el.textContent?.trim() === "—");
}
