import { api } from "./client";
import type { HistoricalDate } from "../domain/dates";

export interface LedgerStatsOverview {
  total_souls: number;
  state_distribution: { state: string; label: string; count: number }[];
  tenants: {
    tenant_id: number;
    tenant_code: string;
    tenant_name: string;
    total_souls: number;
    state_breakdown: Record<string, number>;
  }[];
  karma_distribution: { label: string; count: number }[];
  recent_activity: {
    id: number;
    action: string;
    resource: string;
    resource_id: string;
    description: string;
    user: string;
    timestamp: string;
  }[];
  souls_by_realm: {
    realm_code: string;
    realm_name: string;
    civilization?: string;
    count: number;
  }[];
}

/**
 * The facts *poena* presupposes and which the ledger does not record, mirroring
 * `POENA_MISSING_INPUTS` in backend/apps/ledger/readings.py.
 *
 * This used to be an English sentence on the wire (`poena_unavailable`) that
 * nothing read, next to three hard-coded `<li>` elements in SoulReadingPanel
 * that said the same thing better. Two copies of one fact, and only one of them
 * would have moved: a fourth missing input on the backend left the panel
 * rendering three bullets with nothing red.
 *
 * `SoulReadingPanel` now renders one bullet per member of the payload's
 * `poena_missing` and derives each bullet's copy key mechanically —
 * `souls.detail.reading.poena_missing_${member.toLowerCase()}`. A member with
 * no key in a bundle therefore reaches the screen as a visible raw key rather
 * than as a quietly shorter list. `src/__tests__/SoulReadingPanel.test.tsx`
 * holds the copy total over this list;
 * `apps/ledger/test_readings.py::TestFrontendMemberListsAgree` holds this list
 * equal to the backend's, which is the half Jest cannot see.
 */
export const POENA_MISSING_INPUTS = ["ABSOLUTION", "SATISFACTION", "PENANCE"] as const;
export type PoenaMissingInput = (typeof POENA_MISSING_INPUTS)[number];

/**
 * Why a ledger got no reading at all, mirroring `UNAVAILABLE_REASON_CODES`.
 *
 * One member, and it is still keyed rather than flat. The copy keys are
 * `souls.detail.reading.unavailable_${code.toLowerCase()}_explanation` and
 * `..._cta`; they used to be the codeless `unavailable_explanation` /
 * `unavailable_cta`, which a second cause of UNAVAILABLE would have inherited
 * silently and been mis-described by — a real string, in the right language, in
 * the right place, saying the wrong thing. That is the `ledger.civ.UNKNOWN`
 * defect `civilizationCopyCoverage.test.ts` exists because of.
 */
export const UNAVAILABLE_REASON_CODES = ["TENANT_NOT_MAPPED"] as const;
export type UnavailableReasonCode = (typeof UNAVAILABLE_REASON_CODES)[number];

/**
 * The facts elapsed time presupposes and which the ledger does not record,
 * mirroring `SENTENCE_MISSING_INPUTS` in backend/apps/ledger/readings.py.
 *
 * Same device as POENA_MISSING_INPUTS above, and the panel renders them the
 * same way: one bullet per member the backend sent, copy key derived as
 * `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`.
 *
 * Two members for two roads, not two per road. The SENTENCE reading reports a
 * left-hand and a right-hand road, and they share one clock: Republic X judges
 * the souls together, sends them out together, and gathers them in the meadow
 * when the same thousand years are up. So the ledger is missing one start date
 * and one elapsed figure, and a second parallel list would claim four absences
 * where there are two.
 *
 * Both members or neither. TIME_SERVED is not a second stored fact beside
 * TERM_START — it is what measuring from TERM_START produces — so a recorded
 * term start supplies both at once and the backend sends `[]`. The list is the
 * description of the absent case, and the absent case is all-or-nothing.
 */
export const SENTENCE_MISSING_INPUTS = ["TERM_START", "TIME_SERVED"] as const;
export type SentenceMissingInput = (typeof SENTENCE_MISSING_INPUTS)[number];

/**
 * Every `kind` the reading endpoint can return.
 *
 * Declared as an array and not only as the union below because the union is
 * unreadable from Python, and Python is the only side that can see the failure
 * this list exists for. `f92ed35` added a fourth civilization whose reading
 * carries `kind: "SENTENCE"`; the union here stayed at four members, the
 * `switch` in SoulReadingPanel stayed at four branches with no `default`, and
 * `tsc` was satisfied throughout — a switch is exhaustive over the union *this
 * file* declares, so a kind this file has never heard of is not a type error,
 * it is a component that returns `undefined` and renders as blank. Nothing was
 * red for the whole time a Greek soul's ledger panel was empty.
 *
 * `apps/ledger/test_readings.py::TestFrontendMemberListsAgree` reads this array
 * as text and compares it to the kinds the backend builders actually produce.
 * READING_KINDS_AGREE below is what keeps the array honest about the union, so
 * that the Python-side comparison is a comparison against what renders.
 */
export const READING_KINDS = [
  "BALANCE",
  "THRESHOLD",
  "GUILT_AND_PENALTY",
  "SENTENCE",
  "UNAVAILABLE",
] as const;
export type LedgerReadingKind = (typeof READING_KINDS)[number];

/**
 * What each cosmology reads off the ledger. Discriminated on `kind` —
 * apps/ledger/readings.py deliberately does not force one shape on all four.
 */
export type LedgerReading =
  | { kind: "BALANCE"; civilization: string; balance: number; merit: number; demerit: number }
  | { kind: "THRESHOLD"; civilization: string; heart_weight: number; counterweight: number; heavier_than_feather: boolean }
  | {
      kind: "GUILT_AND_PENALTY";
      civilization: string;
      culpa: number;
      culpa_record_count: number;
      poena: null;
      /** Non-empty for as long as `poena` is null — see POENA_MISSING_INPUTS. */
      poena_missing: PoenaMissingInput[];
    }
  | {
      /** GREEK — Plato's thousand-year circuit, repaid tenfold (Republic X, 615a-b). */
      kind: "SENTENCE";
      civilization: string;
      /** The left-hand road (614c): the number of recorded wrongs, counted as
       *  deeds. NOT the demerit sum: Republic X multiplies per wrong done, and
       *  `weight` is this system's own severity scale, which no source grades a
       *  term of years by. */
      wrongs: number;
      /** The right-hand road: the number of recorded good deeds, requited "in
       *  the same measure" (615b). A count, like `wrongs`, and standing beside
       *  it rather than against it — the two roads run in parallel over one
       *  circuit, so their difference is not a reading, it is the Chinese net
       *  balance under a Greek name. Never subtract, never sum, never total. */
      benefactions: number;
      /** 10. One rule for both roads — what is repaid per deed — and not a
       *  balance. Multiplying it by either count and printing the product would
       *  state a debt the source does not, which is the "rule rendered as a
       *  balance" collapse this file's other readings exist to stop. */
      repayment_multiple: number;
      /** 1000. The length of one circuit, i.e. the unit both roads' repayment is
       *  reckoned in — not the length of this soul's term. */
      circuit_years: number;
      /** Whole years of the term already run, or null when the ledger holds
       *  no start to measure from. One clock for both roads: Republic X judges
       *  the souls together and gathers them in the same meadow, so this is
       *  one figure and not one per road.
       *
       *  It was `null` — the type, not the value — for as long as nothing
       *  recorded when a term began. `Disposition.term_start` records it, and
       *  the backend measures from there to today; a disposition without one
       *  still reports null, which is every row written before that column
       *  existed. NOT a fraction of `circuit_years` and never clamped to it: a
       *  soul can have served longer than one circuit, and saying so is not the
       *  same as saying it came back. */
      elapsed_years: number | null;
      /** Non-empty for exactly as long as `elapsed_years` is null, and empty
       *  the moment it is a number — see SENTENCE_MISSING_INPUTS. The two are
       *  one fact told twice, so a payload carrying both is contradicting
       *  itself and the panel renders whichever the number decides. */
      elapsed_missing: SentenceMissingInput[];
    }
  | { kind: "UNAVAILABLE"; civilization: string; reason_code: UnavailableReasonCode };

/** `true` only when READING_KINDS and the union enumerate the same kinds. */
type KindsAgree<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * Compile-time bridge between the two declarations above.
 *
 * Without it READING_KINDS is a list somebody has to remember to update, and
 * the Python test that reads it would certify agreement with a list that no
 * longer describes what the panel can render. With it, a union member added
 * without an array entry (or the reverse) makes this type `never` and the
 * assignment fails `tsc`. Exported so it is not an unused binding.
 */
export const READING_KINDS_AGREE: KindsAgree<LedgerReading["kind"], LedgerReadingKind> = true;

// What each of these payloads' numbers *are* — magnitude, count, duration or
// ratio — is declared in `./ledgerQuantities`, one table per wire type. It
// imports from here and nothing here imports from it.

/**
 * One entry of `LedgerSummary.records`, built by hand in
 * LedgerService.get_ledger_summary (backend/apps/ledger/services.py:350-372) —
 * NOT SoulRecordSerializer. The two differ: this payload renames record_type
 * to `type` and weight to `original_weight`, and adds the decay figures.
 * `soul`, `record_type`, `weight` and `create_time` were declared here and
 * are not in the response at all.
 */
export interface LedgerRecord {
  id: string;
  type: string;
  category: string;
  description: string;
  original_weight: number;
  effective_weight: number;
  years_elapsed: number;
  decay_factor: number;
  civilization: string;
  recorded_at: string;
  /** HistoricalDateField: {year, month, day} | null */
  event_date: HistoricalDate | null;
  is_milestone: boolean;
}

/** 200 body of GET /souls/{id}/karma/ and GET /ledger/balance/{soul_id}/. */
export interface LedgerSummary {
  soul_id: string;
  soul_name: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
  record_count: number;
  records: LedgerRecord[];
  reading: LedgerReading;
}

// 200 body of GET /ledger/inheritance/{soul_id}/.
export interface LedgerInheritance {
  soul_id: string;
  inherited_merit: number;
  inherited_demerit: number;
  /** Fraction of merit that survives the gate — 0.2 today. Was an English
   * `inheritance_note` sentence composed in apps/ledger/services.py; the rates
   * come over as numbers now so the wording can live in the message bundles
   * and the card can stop mirroring the constants as literals. */
  inheritance_merit_rate: number;
  /** Fraction of unripened demerit that survives — 1.0 today, deliberately not
   * symmetric with the above. */
  inheritance_demerit_rate: number;
}

// 409 body — the soul's cosmology is terminal (e.g. Egyptian judgment ending
// at Aaru/Ammit, or European judgment ending at Heaven/Hell/Purgatory-then-
// Heaven), so there is no next life to inherit into.
export interface LedgerInheritanceNotApplicable {
  code: string;
  civilization: string;
  detail: string;
}

/** 200 body of POST /ledger/calculate/{soul_id}/. */
export interface LedgerRecalculation {
  soul_id: string;
  merit_score: number;
  demerit_score: number;
  karmic_balance: number;
}

export const ledgerApi = {
  // soulId is a UUID: both routes are `<uuid:soul_id>` in
  // backend/apps/ledger/urls.py. These took `number`, which cannot address
  // a soul at all.
  balance: (soulId: string) => api.get<LedgerSummary>(`/ledger/balance/${soulId}/`),
  recalculate: (soulId: string) => api.post<LedgerRecalculation>(`/ledger/calculate/${soulId}/`),
  // Note the ordering: inheritance/ comes before the soul id in the URLconf.
  inheritance: (soulId: string) => api.get<LedgerInheritance>(`/ledger/inheritance/${soulId}/`),
  statsOverview: () => api.get<LedgerStatsOverview>("/ledger/stats/overview/"),
  exportStats: (params?: Record<string, string>) => api.get<Blob>("/ledger/stats/export/", { params, responseType: "blob" }),
};
