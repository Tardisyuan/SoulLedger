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
// `SoulKarmaLedgerCard.tsx` is still on the legacy classes today; 287 legacy
// type classes remain under `src/components/`, against 10 under `app/`, because
// Stage 11 migrated pages and not shared components.
const FIGURE_SIZE = /(^|\s)(text-(lg|xl|2xl|3xl)|text-0[678])(\s|$)/;
const BOLD = /(^|\s)(font-bold|text-0[678])(\s|$)/;

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
    return BOLD.test(cls) && FIGURE_SIZE.test(cls);
  });
}

export function unclassifiedHeadlines(container: HTMLElement): string[] {
  return figureSlots(container)
    .filter((el) => !el.hasAttribute("data-quantity") && !el.hasAttribute("data-quantity-absent"))
    .map((el) => (el.textContent ?? "").trim());
}
