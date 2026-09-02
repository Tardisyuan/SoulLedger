/**
 * What the ledger's numbers *are* — the distinction that was missing from the
 * screen, not from the payload.
 *
 * Split out of `ledger.ts`, which declares the payloads. That file says a
 * reading carries a `culpa` and a summary carries a `merit_score`; this one
 * says what kind of quantity each of those is, and with four tables that is a
 * concern of its own rather than an appendix to the wire types. The dependency
 * runs one way — this module imports the payload types and `ledger.ts` imports
 * nothing back — so the classification can never be the reason a type is hard
 * to change.
 */
import type {
  LedgerInheritance,
  LedgerReading,
  LedgerReadingKind,
  LedgerRecord,
  LedgerSummary,
} from "./ledger";

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
 *     `ledger.figure_scale_weight`.
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
export type NumericFields<T> = {
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
 * `karmic_balance`) rather than from the reading, so they are classified by
 * `SUMMARY_QUANTITIES` below and not here — see the note on that table for why
 * this one was not simply widened to hold them.
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
 * What one ledger row's numbers are.
 *
 * Classified in full, drawn almost nowhere — which is the same standing
 * `repayment_multiple` and `circuit_years` have above, and it is deliberate.
 * `SoulKarmaLedgerCard` sums `original_weight` across the rows to get the raw
 * merit and demerit totals it prints; those totals are derived figures with no
 * field of their own, so they take their kind from the field they are sums of
 * rather than from a literal typed at the call site. A literal there is a
 * fourth copy of an answer this file already gives, and the copies are what
 * drift.
 *
 * `decay_factor` is a ratio and `years_elapsed` is a duration, and neither is a
 * weight. They are classified here so that the next panel to print one has to
 * say which, rather than reaching for the bold numeral that a weight sum uses.
 */
export const RECORD_QUANTITIES: Record<NumericFields<LedgerRecord>, QuantityKind> = {
  original_weight: "magnitude",
  effective_weight: "magnitude",
  years_elapsed: "duration",
  decay_factor: "ratio",
};

/**
 * What a *ledger summary's* numbers are — the same question `READING_QUANTITIES`
 * answers, asked of a different payload.
 *
 * WHY THIS IS A SECOND TABLE AND NOT MORE ROWS IN THE FIRST.
 * `READING_QUANTITIES` is indexed by `kind`, and every guarantee it carries
 * comes from that: `Record<NumericFields<Extract<LedgerReading, {kind: K}>>,
 * QuantityKind>` is a statement about *one* payload shape, so `tsc` can say
 * "this field is unclassified" and "this classification names no field". Add a
 * second indexing scheme to the same object — some keys reading kinds, some
 * keys payload types — and that mapped type has to be loosened to accommodate
 * both, at which point the compile-time half stops being a guarantee and
 * becomes a convention. The whole reason `185e70c` beat the `READING_KINDS`
 * array is that the compiler was looking at the thing that actually moved.
 *
 * So: one table per wire type, each one exactly `Record<NumericFields<T>,
 * QuantityKind>`, and the guarantee is preserved verbatim in each. The cost of
 * more tables is that the same concept is classified more than once and the
 * copies are free to drift — `merit` is a magnitude in
 * `READING_QUANTITIES.BALANCE` and `merit_score` had better be one here.
 * `QUANTITY_ALIASES` below is what pins that; it is the reason these are
 * parallel tables rather than unrelated ones.
 *
 * `record_count` is a count and is deliberately classified even though no panel
 * draws it as a figure — it renders as "5 条记录", a numeral with its noun
 * attached, which is the same treatment `culpa_record_count` gets and for the
 * same reason: a row tally at a weight sum's size, beside a weight sum, is the
 * confusion this whole line of work is about.
 *
 * This table also covers the judgment queue's `QueueLedger`, whose numbers are
 * these numbers under these names — see `QUEUE_LEDGER_NUMBERS_ARE_SUMMARY_NUMBERS`
 * in `lib/api/judgment.ts`, which fails to compile if that stops being true.
 */
export const SUMMARY_QUANTITIES: Record<NumericFields<LedgerSummary>, QuantityKind> = {
  // LedgerService.get_ledger_summary sums `effective_weight`, so these are
  // time-decayed sums of SoulRecord.weight. Decayed or raw, a sum of weights is
  // a position on the weight scale, and so is the difference of two of them.
  merit_score: "magnitude",
  demerit_score: "magnitude",
  karmic_balance: "magnitude",
  // A tally of ledger rows. The one number here that is not on the weight
  // scale, which is exactly why it has to be said out loud.
  record_count: "count",
};

/**
 * What the next-life preview's numbers are.
 *
 * Two sums and two rates, and the split is the point. `inherited_merit` and
 * `inherited_demerit` are weight sums that have been through the gate, so they
 * are magnitudes and belong on the same scale as everything above.
 *
 * The two rates are NOT. They are fractions — 0.2 and 1.0 — and `66a5a3f`
 * turned them from an English sentence composed on the backend into numbers on
 * the wire precisely so the frontend would stop mirroring the constants. A
 * fraction rendered with the weight scale beside it would say the *rate* was
 * measured in weight, which is the `elapsed_years` mistake arriving from the
 * other side: a number given the kind it looks like rather than the kind it is.
 * They reach the screen as a percentage inside `ledger.carry_forward_rate` and
 * as the width of the two bars, and neither of those is a figure — same
 * standing as `repayment_multiple` and `circuit_years`, which are classified
 * above and drawn nowhere.
 */
export const INHERITANCE_QUANTITIES: Record<NumericFields<LedgerInheritance>, QuantityKind> = {
  inherited_merit: "magnitude",
  inherited_demerit: "magnitude",
  inheritance_merit_rate: "ratio",
  inheritance_demerit_rate: "ratio",
};

/** One field of one reading kind, named in a way `tsc` can check both halves of. */
export type ReadingFieldRef = {
  [K in LedgerReadingKind]: { kind: K; field: keyof (typeof READING_QUANTITIES)[K] };
}[LedgerReadingKind];

/** The classification a `ReadingFieldRef` points at. */
export function readingQuantityOf(ref: ReadingFieldRef): QuantityKind {
  return (READING_QUANTITIES[ref.kind] as Record<string, QuantityKind>)[ref.field];
}

/**
 * One quantity, under the names three different payloads give it.
 *
 * This is the seam more than one table buys and a single one would not have
 * had. The Chinese reading's `merit`, the summary's `merit_score` and the
 * inheritance preview's `inherited_merit` are all sums of `SoulRecord.weight`;
 * they are classified in three separate objects, and nothing about
 * `Record<NumericFields<T>, QuantityKind>` makes the three agree. A
 * `merit_score` quietly demoted to "count" would take the scale marker off half
 * the numbers on the soul detail page while every per-table check stayed green
 * — which is precisely the shape of drift this repository keeps finding after
 * the fact.
 *
 * `tsc` checks that each name exists in its own table; `ledgerQuantityContract`
 * checks that the three classifications are the same kind, and states
 * separately and literally which kind that is, so agreeing on the wrong answer
 * is not a way to pass.
 *
 * `karmic_balance` has no inheritance counterpart: the preview reports the two
 * inherited sums and the card derives their difference for display, so there is
 * no third *field* to keep honest.
 */
export interface QuantityAlias {
  reading: ReadingFieldRef;
  summary: NumericFields<LedgerSummary>;
  inheritance: NumericFields<LedgerInheritance> | null;
}

export const QUANTITY_ALIASES: readonly QuantityAlias[] = [
  { reading: { kind: "BALANCE", field: "merit" }, summary: "merit_score", inheritance: "inherited_merit" },
  { reading: { kind: "BALANCE", field: "demerit" }, summary: "demerit_score", inheritance: "inherited_demerit" },
  { reading: { kind: "BALANCE", field: "balance" }, summary: "karmic_balance", inheritance: null },
];
