/**
 * Payloads and bundle lookups shared by the two halves of the ledger quantity
 * contract — `ledgerQuantityContract.test.tsx` (the tables) and
 * `ledgerQuantityContract.render.test.tsx` (the DOM).
 *
 * Deliberately free of component imports. The tables half asserts things about
 * `SUMMARY_QUANTITIES` and friends and renders nothing; pulling
 * `SoulKarmaLedgerCard` into it through a shared module would drag
 * `LazyDashboardCharts` and its jsdom flake along with it for no reason. The
 * render helpers live next door in `ledgerQuantityRender.tsx`, which is the
 * file that does import components.
 *
 * Not named `*.test.ts` on purpose: `suiteShape.test.ts` walks this directory
 * for `/\.test\.tsx?$/` and requires every match to be registered by name.
 */
import type { LedgerInheritance, LedgerReading, LedgerRecord } from "@/lib/api/ledger";
import type { QueueLedger } from "@/lib/api/judgment";

import en from "../../../messages/en.json";
import egy from "../../../messages/egy.json";
import zhHans from "../../../messages/zh-Hans.json";

export const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** Dotted lookup into a bundle. */
export function at(bundle: unknown, path: string): unknown {
  let node: unknown = bundle;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export { zhHans };

/** The provider's default locale, so these are the strings that render. */
export const ZH = {
  /** `ledger.figure_scale_weight` — the marker a magnitude carries. */
  scale: "权重",
  records: "条记录",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function record(
  over: Partial<LedgerRecord> & Pick<LedgerRecord, "id" | "type" | "original_weight">
): LedgerRecord {
  return {
    category: "GENERAL",
    description: "",
    effective_weight: over.original_weight,
    years_elapsed: 0,
    decay_factor: 1,
    civilization: "CHINESE",
    recorded_at: "2020-01-01T00:00:00Z",
    event_date: null,
    is_milestone: false,
    ...over,
  };
}

/** Raw 30 / 12, decayed 24 / 9 — the two pairs must differ or the inventory
 *  in the render half could not tell a raw sum from a decayed one. */
export const RECORDS: LedgerRecord[] = [
  record({ id: "r1", type: "MERIT", original_weight: 30, effective_weight: 24 }),
  record({ id: "r2", type: "DEMERIT", original_weight: 12, effective_weight: 9 }),
];

export const BALANCE_READING: LedgerReading = {
  kind: "BALANCE", civilization: "CHINESE", merit: 24, demerit: 9, balance: 15,
};

export const THRESHOLD_READING: LedgerReading = {
  kind: "THRESHOLD", civilization: "EGYPTIAN",
  heart_weight: 18, counterweight: 1, heavier_than_feather: true,
};

export const SENTENCE_READING: LedgerReading = {
  kind: "SENTENCE", civilization: "GREEK",
  wrongs: 4, benefactions: 3, repayment_multiple: 10, circuit_years: 1000,
  elapsed_years: null, elapsed_missing: ["TERM_START", "TIME_SERVED"],
};

export const INHERITANCE: LedgerInheritance = {
  soul_id: "soul-1",
  inherited_merit: 5,
  inherited_demerit: 9,
  inheritance_merit_rate: 0.2,
  inheritance_demerit_rate: 1,
};

/** Carries `reading` because the payload does: `QueueLedger` declares it
 *  optional, but it is `LedgerService.get_ledger_summary`'s body and that
 *  function always builds one. A fixture without it exercised the fail-closed
 *  path while claiming to be the ordinary case. */
export const QUEUE_LEDGER: QueueLedger = {
  soul_id: "soul-1",
  soul_name: "张三",
  merit_score: 120,
  demerit_score: 78,
  karmic_balance: 42,
  record_count: 0,
  records: [],
  reading: { kind: "BALANCE", civilization: "CHINESE" },
};

/** The same ledger under a cosmology that does not net. */
export const QUEUE_LEDGER_THRESHOLD: QueueLedger = {
  ...QUEUE_LEDGER,
  reading: { kind: "THRESHOLD", civilization: "EGYPTIAN" },
};

/** The numeric fields a payload actually carries, found by looking. */
export function numericFieldsOf(payload: object): string[] {
  return Object.entries(payload)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key)
    .sort();
}
