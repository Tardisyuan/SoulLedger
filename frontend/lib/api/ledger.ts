import { api } from "./client";
import type { HistoricalDate } from "@/lib/utils";

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

/**
 * What a reading's numbers *are* — the distinction that was missing from the
 * screen, not from the payload.
 *
 * The defect: European `culpa` (22) and a Greek road's count (4) were both
 * drawn as one bold numeral, so they read as two values of one quantity and
 * the larger one read as the worse soul. They are not one quantity. `culpa` is
 * a sum of `SoulRecord.weight`; a road is a tally of ledger rows. Nothing
 * relates them, and cross-tenant sorting will happily put them in one column
 * anyway, so the difference has to be visible in the figure itself.
 *
 * Four kinds, not the two the fix was first scoped for. Compressing durations
 * and ratios into "magnitude" or "count" would manufacture the next pair of
 * numbers that look alike and are not:
 *
 *   * `magnitude` — a position on `SoulRecord.weight`, this system's own
 *     severity scale (the field's help_text says "Significance weight
 *     (1-100)"). It is not a tally of anything and it has no unit outside this
 *     codebase: 分 is the 功過格's own unit and borrowing it for Purgatorio or
 *     the Hall of Two Truths would be the netting mistake wearing a different
 *     hat. So the panels name the *scale* rather than invent a unit — see
 *     `souls.detail.reading.figure_scale_weight`.
 *   * `count` — a whole number of ledger rows. Honest unit: the deed. Every
 *     count on screen already carries its noun ("5 项记录", "桩在案过错").
 *   * `duration` — whole years. Honest unit, and already inside the value
 *     (`sentence_elapsed_years` is "{{years}} 年", never a bare 2424).
 *   * `ratio` — dimensionless, and already inside the value as "×" or as the
 *     "-fold" of the repayment rule.
 *
 * So exactly one kind has no honest unit, and it is the one that was being
 * mistaken for a count. That asymmetry is the whole design.
 */
export const QUANTITY_KINDS = ["magnitude", "count", "duration", "ratio"] as const;
export type QuantityKind = (typeof QUANTITY_KINDS)[number];

/**
 * The numeric fields of one reading member.
 *
 * `NonNullable` so `elapsed_years: number | null` counts — the absent case is
 * still a duration, and the panel draws an em-dash in a duration's slot rather
 * than in a slot of no kind at all. `poena: null` does *not* count: its type is
 * `null`, not `number | null`, because this reading refuses to compute it, and
 * classifying a number nobody computes would be a claim about a quantity that
 * does not exist.
 */
type NumericFields<T> = {
  [K in keyof T]-?: number extends NonNullable<T[K]> ? K : never;
}[keyof T];

/**
 * Every number the wire carries, and what kind of quantity each one is.
 *
 * `Record<NumericFields<...>, QuantityKind>` is the half `tsc` can hold: a
 * numeric field added to a reading without an entry here fails to compile, and
 * so does an entry for a field that does not exist. That is the direction the
 * `READING_KINDS` array could not cover on its own — `f92ed35` added a whole
 * `kind` and the compiler stayed green because the *union* was the half nobody
 * updated. Here the union is the source, so the compiler is looking at the
 * thing that actually moved.
 *
 * Being classified is not the same as being drawn as a figure. Four of these
 * live inside a sentence, where the sentence states the quantity in words and a
 * separate numeral would be the same fact twice:
 *
 *   * `counterweight` — "羽重 = 1" inside the threshold hint. The Egyptian
 *     headline is the *ratio* of heart to feather, which is a derived figure
 *     and has no field of its own here.
 *   * `culpa_record_count` — "5 项记录", the caption under culpa. It is the
 *     count that culpa is *not*, which is exactly why it must not become a
 *     second numeral of the same size beside it.
 *   * `repayment_multiple` — interpolated into the fork's apex rule. Rendering
 *     it standalone would restate a rule as a figure, which `ef7df3d` argued
 *     out already.
 *   * `circuit_years` — interpolated into the circuit sentence, below the fork,
 *     deliberately not a headline (1000 next to the word "sentence" would say
 *     this soul was sentenced to a thousand years).
 *
 * `UNAVAILABLE` has no numeric field, so its entry is empty and `Record<never,
 * QuantityKind>` accepts nothing else. The three raw sums that panel prints
 * come from `LedgerSummary` (`merit_score` / `demerit_score` /
 * `karmic_balance`) rather than from the reading; they are the same weight sums
 * and the panel marks them `magnitude` for that reason.
 */
export const READING_QUANTITIES: {
  [K in LedgerReadingKind]: Record<NumericFields<Extract<LedgerReading, { kind: K }>>, QuantityKind>;
} = {
  // Sums of SoulRecord.weight, including the difference of two of them — a
  // difference of magnitudes is still a magnitude, and 功過格's 分 is what it
  // is measured in *here* specifically. Named as the generic scale anyway, so
  // that one panel does not teach a unit the other three must then refuse.
  BALANCE: { merit: "magnitude", demerit: "magnitude", balance: "magnitude" },
  // The heart is the demerit sum; the feather is MAAT_FEATHER_WEIGHT, which is
  // 1 *in SoulRecord.weight units* and is a product decision rather than a
  // sourced figure. Both are magnitudes; their quotient is the ratio the panel
  // draws, and the quotient is not a payload field.
  THRESHOLD: { heart_weight: "magnitude", counterweight: "magnitude" },
  // The pair the review is about: a weight sum and a row tally, side by side.
  GUILT_AND_PENALTY: { culpa: "magnitude", culpa_record_count: "count" },
  // Republic X counts deeds, so both roads are counts and neither is a weight
  // sum — see `_greek_reading`'s "WHY `wrongs` IS THE RECORD COUNT". The other
  // three are a rule, a period and a served interval: a ratio and two
  // durations, and not one of the three is a count of anything.
  SENTENCE: {
    wrongs: "count",
    benefactions: "count",
    repayment_multiple: "ratio",
    circuit_years: "duration",
    elapsed_years: "duration",
  },
  // No reading, therefore no numbers of its own.
  UNAVAILABLE: {},
};

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
