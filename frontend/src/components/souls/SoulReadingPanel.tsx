"use client";

import type { ReactNode } from "react";

import {
  READING_QUANTITIES,
  type LedgerReading,
  type QuantityKind,
  type UnavailableReasonCode,
} from "@/lib/api/ledger";
import { useI18n } from "@/src/contexts/I18nContext";

type TFunc = (key: string, params?: Record<string, string>) => string;

interface SoulReadingPanelProps {
  reading: LedgerReading;
  /** Raw ledger sums — always true of any ledger, always present in the
   * payload even for UNAVAILABLE, but only meaningful as "plain data" there
   * (see UnavailableReading below). */
  meritScore: number;
  demeritScore: number;
  karmicBalance: number;
}

/**
 * The reading this soul's cosmology takes off its ledger — see
 * backend/apps/ledger/readings.py. Five mechanically different shapes
 * behind `reading.kind`, not one net-balance number rendered five ways:
 * netting merit against demerit is the Chinese instrument specifically,
 * and showing it under an Egyptian, European or Greek verdict would let a
 * familiar-looking number quietly overrule the actual reading.
 *
 * The `default` branch is not decoration. This component had four branches
 * and no default for as long as the backend had four kinds and then five:
 * `SENTENCE` fell through, the function returned `undefined`, React rendered
 * it as nothing, and every Greek soul's ledger card was blank with no error
 * anywhere. `tsc` was green the whole time, because a switch is exhaustive
 * over the union declared in `lib/api/ledger.ts` and that union was the half
 * that had not been updated. See the branch itself.
 *
 * `karmic_balance` is deliberately never displayed here for anything but
 * BALANCE — see the UNAVAILABLE branch for why the raw sums still show up
 * as plain data rather than being hidden outright.
 */
export function SoulReadingPanel({ reading, meritScore, demeritScore, karmicBalance }: SoulReadingPanelProps) {
  const { t } = useI18n();

  switch (reading.kind) {
    case "BALANCE":
      return <BalanceReading reading={reading} t={t} />;
    case "THRESHOLD":
      return <ThresholdReading reading={reading} t={t} />;
    case "GUILT_AND_PENALTY":
      return <GuiltAndPenaltyReading reading={reading} t={t} />;
    case "SENTENCE":
      return <SentenceReading reading={reading} t={t} />;
    case "UNAVAILABLE":
      return (
        <UnavailableReading
          reasonCode={reading.reason_code}
          meritScore={meritScore}
          demeritScore={demeritScore}
          karmicBalance={karmicBalance}
          t={t}
        />
      );
    default: {
      // Two halves, guarding two different mistakes.
      //
      // Compile time: `never` fails to accept `reading` the moment a member is
      // added to `LedgerReading` without a branch above. That is the half `tsc`
      // could always have given us and did not, because there was no `default`
      // for it to check — an exhaustive switch with no default silently returns
      // `undefined` on a fall-through and React 18 renders `undefined` as
      // nothing at all, with no warning and no error.
      const unhandled: never = reading;
      // Run time: the half that actually matters here, and the one `tsc` cannot
      // ever provide. `f92ed35` added `kind: "SENTENCE"` on the backend; this
      // file's union did not know about it, so the switch stayed exhaustive
      // *over the union* and compiled clean while a Greek soul's panel rendered
      // blank. A kind the union has never heard of is not a type error, it is
      // data — so it has to be caught here, at run time, and said out loud.
      // `apps/ledger/test_readings.py::TestFrontendMemberListsAgree` is what
      // turns this from a silent blank into a red build; this is what the user
      // sees in the window between a backend deploy and a frontend one.
      return <UnrenderableReading kind={(unhandled as LedgerReading).kind} t={t} />;
    }
  }
}

// ── One number, drawn as the kind of quantity it is ─────────────────────
//
// The defect this exists for: European `culpa` and a Greek road's count were
// both `text-xl font-bold`, so 22 and 4 sat side by side and read as two values
// of one quantity — "this soul is worse". 22 is a sum of `SoulRecord.weight`
// and 4 is a tally of ledger rows. Nothing relates them, and a cross-tenant
// listing will sort them into one column anyway.
//
// `3fdbbba` left the two class strings no longer identical, but only because
// the Greek fork had just been told to stop using the merit/demerit palette.
// A distinction arrived at as a side effect can be lost as a side effect, so
// the kind is now declared — `data-quantity` — rather than inferred from
// whatever styling a panel happens to have.
//
// WHY THE MARKER IS A SCALE AND NOT A UNIT. Three of the four kinds already
// say what they are inside the value or the caption next to it: a duration is
// "{{years}} 年", a ratio ends in "×", a count has its noun ("5 项记录",
// "桩在案过错"). Only magnitudes are mute, and they are mute because there is
// no honest unit to print. `SoulRecord.weight` calls itself "Significance
// weight (1-100)" — a scale this system invented. 分 is the 功過格's own unit
// and borrowing it for Purgatorio or the Hall of Two Truths would be the
// netting mistake in different clothes; "points" would sound like a score.
// So the marker names the scale rather than claiming a unit, and it is the one
// piece of copy on the panel whose job is to say "this number is not a tally".
//
// The marker is NOT `aria-hidden`, unlike the em-dash below it. The em-dash is
// hidden because the sentence under it says the same thing; nothing else here
// says what culpa is measured on, so hiding the marker would hand a screen
// reader the bare "22" this component was fixed for.
function Figure({
  field,
  quantity,
  className,
  numeralProps,
  children,
  t,
}: {
  /** The payload field this figure shows, or a name for a derived one. */
  field: string;
  quantity: QuantityKind;
  className: string;
  /** Extra attributes for the numeral itself — `Road` keeps its own
   *  `data-road-count` hook on the styled element rather than on a wrapper, so
   *  the fork's "both roads are drawn identically" assertions go on comparing
   *  the classes that actually draw them. */
  numeralProps?: Record<string, string>;
  children: ReactNode;
  t: TFunc;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      {/* The numeral, and nothing but the numeral: `data-quantity` elements are
          compared by text in the contract test, and a marker inside this span
          would make a magnitude's text differ from the number it prints. */}
      <span {...numeralProps} data-quantity={quantity} data-quantity-field={field} className={className}>
        {children}
      </span>
      {quantity === "magnitude" && (
        <span
          data-quantity-scale={field}
          className="text-[11px] font-normal text-[hsl(var(--color-ink-subtle))]"
        >
          {t("souls.detail.reading.figure_scale_weight")}
        </span>
      )}
    </span>
  );
}

// ── CHINESE (功过格) — a cumulative net account ──────────────────────
function BalanceReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "BALANCE" }>;
  t: TFunc;
}) {
  // All three are sums of SoulRecord.weight — and a difference of two of them
  // is still one. 功過格 is the one cosmology whose own tradition names the
  // unit (分, per 不善門#8's 夾注), and this panel still shows the generic
  // scale: a unit taught here is a unit the Egyptian and European panels would
  // then have to refuse, in the same slot, for the same number.
  const q = READING_QUANTITIES.BALANCE;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-[hsl(var(--color-karma-merit))]">{t("souls.detail.merit")}</span>
        <Figure
          field="merit"
          quantity={q.merit}
          t={t}
          className="text-lg font-bold tabular-nums text-[hsl(var(--color-karma-merit))]"
        >
          +{reading.merit}
        </Figure>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.demerit")}</span>
        <Figure
          field="demerit"
          quantity={q.demerit}
          t={t}
          className="text-lg font-bold tabular-nums text-[hsl(var(--color-karma-demerit))]"
        >
          -{reading.demerit}
        </Figure>
      </div>
      <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
        <span className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
        <Figure
          field="balance"
          quantity={q.balance}
          t={t}
          className={`text-xl font-bold tabular-nums ${
            reading.balance >= 0 ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"
          }`}
        >
          {reading.balance >= 0 ? "+" : ""}
          {reading.balance}
        </Figure>
      </div>
    </div>
  );
}

// ── EGYPTIAN (称心) — a threshold: the heart against a fixed feather ──
function ThresholdReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "THRESHOLD" }>;
  t: TFunc;
}) {
  const ratio = reading.counterweight > 0 ? reading.heart_weight / reading.counterweight : reading.heart_weight;
  const ratioText = `${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}×`;
  const failed = reading.heavier_than_feather;

  return (
    <div className="space-y-3">
      {/* The ratio, not a pass/fail badge, is the headline — feather=1 makes
          "heavier than the feather" true for nearly every soul with any
          recorded wrongdoing, so a badge that reads "fail" forever would
          convey nothing. The ratio is at least a number that moves. */}
      <div className="flex flex-col items-center py-1">
        {/* A ratio, and marked as one. It is derived rather than sent, so it has
            no entry in READING_QUANTITIES — the two magnitudes it is made of do,
            and they stay in the sentence below. */}
        <Figure
          field="ratio"
          quantity="ratio"
          t={t}
          className={`text-3xl font-bold tabular-nums ${
            failed ? "text-[hsl(var(--color-status-error))]" : "text-[hsl(var(--color-karma-merit))]"
          }`}
        >
          {ratioText}
        </Figure>
        {/* The hint states the two magnitudes and names the scale they are on;
            the multiple is the headline's business alone.

            It used to read "the heart weighs {{weight}}× the feather" with
            `weight` bound to `heart_weight` — a magnitude standing in a ratio's
            slot, correct only because MAAT_FEATHER_WEIGHT is 1. A feather of 2
            would have put 11× above a sentence saying 22×, with nothing red:
            the same "a number is not the kind it looks like" defect this whole
            change is about, one field along. The scale word is interpolated
            rather than written into the sentence so there is one copy of it. */}
        <span className="text-xs text-[hsl(var(--color-ink-muted))] mt-1 text-center">
          {t("souls.detail.reading.threshold_hint", {
            weight: String(reading.heart_weight),
            counterweight: String(reading.counterweight),
            scale: t("souls.detail.reading.figure_scale_weight"),
          })}
        </span>
      </div>
      <div className="flex justify-center">
        <span
          className={`px-2 py-0.5 rounded text-xs font-bold ${
            failed
              ? "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))]"
              : "bg-[hsl(var(--color-karma-merit)/0.1)] text-[hsl(var(--color-karma-merit))]"
          }`}
        >
          {failed ? t("souls.detail.reading.threshold_fail") : t("souls.detail.reading.threshold_pass")}
        </span>
      </div>
    </div>
  );
}

// ── EUROPEAN (审判与补赎) — two unrelated numbers, never summed ──────
function GuiltAndPenaltyReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "GUILT_AND_PENALTY" }>;
  t: TFunc;
}) {
  return (
    <div className="space-y-4">
      <div>
        {/* The exact pair the design review is about. `culpa` is a weight sum
            and the caption under it is a row tally, and until now the sum was a
            bare numeral with a count sitting directly beneath it — so the
            numeral borrowed the caption's grammar and read as "22 of
            something". It names its scale now; the caption keeps its noun. */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.reading.culpa_label")}</span>
          <Figure
            field="culpa"
            quantity={READING_QUANTITIES.GUILT_AND_PENALTY.culpa}
            t={t}
            className="text-xl font-bold tabular-nums text-[hsl(var(--color-karma-demerit))]"
          >
            {reading.culpa}
          </Figure>
        </div>
        {/* `culpa_record_count` is classified a count and deliberately stays in
            this sentence: a second numeral of culpa's size beside culpa is the
            confusion, not the fix. */}
        <div className="text-xs text-[hsl(var(--color-ink-subtle))] text-right mt-0.5">
          {t("souls.detail.reading.culpa_records", { count: String(reading.culpa_record_count) })}
        </div>
      </div>

      {/* Visually separated from culpa on purpose — a dashed rule, a
          neutral em-dash instead of a number, and no shared axis with the
          figure above. Poena is an honest absence, not a zero, and it must
          never read as something that offsets or compares against culpa. */}
      <div className="border-t border-dashed border-[hsl(var(--color-hairline))] pt-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.reading.poena_label")}</span>
          {/* aria-hidden, not aria-labelled. The label used to be the same key
              as the <p> directly below, so a screen reader announced the
              explanation twice — once as the value and once as itself. The
              glyph's whole job is to occupy the slot a number would have taken;
              the sentence that follows says why it is empty, and it is the next
              thing read. Hiding it cannot make it read as a zero, which is the
              failure mode this position has to avoid.

              `data-quantity-absent`, never `data-quantity`: the slot exists but
              the quantity does not. `poena` is typed `null` rather than
              `number | null` because this reading has no inputs to compute it
              from, so assigning it a kind would be a claim about a quantity
              that has never existed. Compare the elapsed slot below, which is a
              duration the ledger merely has no start date for. */}
          <span
            data-quantity-absent="poena"
            className="text-xl font-bold text-[hsl(var(--color-ink-subtle))]"
            aria-hidden="true"
          >
            —
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
          {t("souls.detail.reading.poena_unavailable_heading")}
        </p>
        {/* One bullet per member the backend actually sent, not three
            hard-coded ones. `poena_missing` is the list readings.py builds the
            absence out of; rendering a fixed three meant a fourth missing
            input would have been dropped with nothing going red. The key is
            derived from the member so a member with no copy shows the raw key
            — ugly, and therefore self-reporting — instead of vanishing. */}
        {reading.poena_missing.length > 0 && (
          <ul className="text-[11px] text-[hsl(var(--color-ink-subtle))] mt-2 space-y-0.5 list-disc list-inside">
            {reading.poena_missing.map((missing) => (
              <li key={missing}>{t(`souls.detail.reading.poena_missing_${missing.toLowerCase()}`)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── GREEK (千年轮回) — one rule, two roads, one clock nobody started ──
//
// A fork, not two stacked rows: the shared tenfold rule at the apex, the two
// counts diverging beneath it, and the shared circuit and the shared elapsed
// absence rejoining below. The lower half keeps GuiltAndPenaltyReading's
// grammar — a dashed rule, an em-dash where a number would go — because
// Europe's absence and Greece's are the same drawing problem and this
// repository has already argued it out once.
//
// Why a fork rather than the two rows this used to be. "The roads never
// combine" cannot survive as a sentence in a comment: two figures sitting one
// above the other in the same column invite the next reader to subtract them,
// and nothing in the layout resists it. A fork has nowhere to put the answer.
// There is no row spanning both roads inside `Fork` and no axis shared between
// them — the gutter is a column of its own and it is empty — so adding a
// derived figure means first inventing a slot for it, and inventing a slot is
// the kind of diff that gets noticed in review. That is the whole argument:
// the prohibition is enforced by the geometry, not by this paragraph.
//
// Neither road is coloured. The merit green and demerit red are the two halves
// of the BALANCE reading's subtraction — that palette *is* a net figure, so
// wearing it here would smuggle the netting back in through the colours after
// the layout had just been rebuilt to forbid it. Both counts are plain ink, and
// they are plain ink at identical weight and size: a road drawn louder than the
// other is a claim about which one matters that Republic X does not make. That
// applies to an empty road too — see `Fork` below.
//
// Road order follows the copy catalogue: owed, then requited.
//
// What is deliberately NOT here:
//   * anything derived from both roads. Not their difference (that is the
//     Chinese balance), not their sum, not a bar split between them. They are
//     parallel repayments over one circuit and the payload relates them by
//     nothing; a figure that relates them would be this panel's invention.
//   * `wrongs × repayment_multiple`, or the same for `benefactions`. Tenfold
//     repayment is the rule Republic X states, not a balance it computes;
//     printing "40" for four wrongs would read as "owes 40", a quantity no
//     source asserts and this system has no unit for. The counts and the rule
//     are shown as what they are and the reader holds them apart.
//   * a second multiple. 615b gives both roads *the same measure*, so the rule
//     is stated once, at the apex, above the point where the roads part. It
//     used to be interpolated into each road's caption, which drew one fact
//     twice and left the two copies free to drift.
//   * a progress bar or a percentage. The denominator is a term length nobody
//     has computed — `circuit_years` is the unit of repayment, not this soul's
//     term — and the prohibition survived `elapsed_years` becoming a real
//     number. It used to rest on both ends being missing; only one of them
//     ever was.
//   * `circuit_years` as a headline. 1000 is the length of one circuit — the
//     unit the repayment is reckoned in — and rendering it large next to the
//     word "sentence" would say this soul was sentenced to a thousand years.
//     It sits below the fork because it is the unit of both roads.
//   * an em-dash for an empty road. A road with no recorded deeds is 0, which
//     the ledger knows; the em-dash is reserved for an elapsed figure it does
//     not. Spending the glyph on both would flatten that distinction — and the
//     distinction is now load-bearing in both directions, because a term start
//     *can* be recorded and 0 years served is then a real answer sitting in the
//     same slot the glyph used to own unconditionally.
function SentenceReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "SENTENCE" }>;
  t: TFunc;
}) {
  return (
    <div className="space-y-4">
      <Fork
        rule={t("souls.detail.reading.sentence_repayment_rule", {
          multiple: String(reading.repayment_multiple),
        })}
        t={t}
        owed={{
          label: t("souls.detail.reading.sentence_owed_label"),
          count: reading.wrongs,
          // Both roads are counts of deeds — Republic X counts wrongs done, not
          // this system's severity weights — so neither carries the weight
          // scale marker and the two stay identically drawn.
          quantity: READING_QUANTITIES.SENTENCE.wrongs,
          detail: t("souls.detail.reading.sentence_owed_detail"),
        }}
        requited={{
          label: t("souls.detail.reading.sentence_requited_label"),
          count: reading.benefactions,
          quantity: READING_QUANTITIES.SENTENCE.benefactions,
          detail: t("souls.detail.reading.sentence_requited_detail"),
        }}
      />

      {/* Below the fork, where the roads have rejoined, because the circuit is
          the unit of both and 615b gives them one. Prose, and outside `Fork`:
          the fork's own subtree holds the apex and the two columns and nothing
          else, which is what keeps a derived figure homeless. */}
      <p className="text-[11px] text-[hsl(var(--color-ink-subtle))]">
        {t("souls.detail.reading.sentence_circuit", { years: String(reading.circuit_years) })}
      </p>

      {/* Same dashed rule, em-dash and absent shared axis as poena *when the
          figure is absent*, and for the same reason: time served is not zero,
          it is unknown. A 0 there would be a claim that the term has not begun,
          which is a fact about a sentence and not one this ledger held. One row
          for both roads: they leave the same judgment and return to the same
          meadow, so there is one elapsed figure.

          The branch is new and the defect it closes is a real one, not a
          hypothetical. `elapsed_years` was typed `null` and this slot drew the
          em-dash unconditionally — it never asked. The moment the backend could
          send a number (Disposition.term_start), an unchanged panel would have
          gone on drawing "—" over a figure it had been given: an absence
          rendered on top of a fact, which is worse than either the old honest
          blank or the new number.

          The condition is `!== null`, not truthiness. 0 is a real answer here
          now — a term that began this year has served no years of it — and
          `elapsed_years && ...` would have redrawn the em-dash over it, which
          is the same defect wearing a shorter operator.

          What is deliberately still NOT here: a progress bar, a percentage, a
          remainder. The denominator would be a term length nobody computes;
          `circuit_years` is the unit of repayment and not this soul's term, and
          dividing by it would state a fraction Republic X does not. And no
          colour on either path — the two roads are plain ink and so is their
          clock. */}
      <div className="border-t border-dashed border-[hsl(var(--color-hairline))] pt-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-[hsl(var(--color-ink-muted))]">
            {t("souls.detail.reading.sentence_elapsed_label")}
          </span>
          {reading.elapsed_years !== null ? (
            /* Not aria-hidden, unlike the em-dash: this one is the value.
               Carried through a copy key rather than printed bare, because
               "2424" under a label reading 已服 states no unit — and the unit
               is the one thing a term of years is measured in.

               A duration, and therefore no weight-scale marker: the unit is
               already inside the value, and appending the severity scale to it
               would say the years were measured in weight. That is the same
               category error as the counts, arriving from the other side. */
            <Figure
              field="elapsed_years"
              quantity={READING_QUANTITIES.SENTENCE.elapsed_years}
              t={t}
              className="text-xl font-bold tabular-nums text-[hsl(var(--color-ink))]"
            >
              {t("souls.detail.reading.sentence_elapsed_years", {
                years: String(reading.elapsed_years),
              })}
            </Figure>
          ) : (
            /* aria-hidden for the same reason as the poena slot above, and
               `data-quantity-absent` for a different reason than poena's: this
               one names the kind that belongs in the slot. A duration is what
               the ledger would hold if it held a start date, so the slot can
               say so; poena is a quantity this cosmology has no inputs for at
               all, and naming a kind there would invent one. */
            <span
              data-quantity-absent="elapsed_years"
              className="text-xl font-bold text-[hsl(var(--color-ink-subtle))]"
              aria-hidden="true"
            >
              —
            </span>
          )}
        </div>
        {reading.elapsed_years === null && (
          <>
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
              {t("souls.detail.reading.elapsed_unavailable_heading")}
            </p>
            {/* One bullet per member the backend sent, key derived from the
                member, exactly as the poena list does it — including the
                failure mode: a member with no copy shows its raw key rather
                than vanishing. */}
            {reading.elapsed_missing.length > 0 && (
              <ul className="text-[11px] text-[hsl(var(--color-ink-subtle))] mt-2 space-y-0.5 list-disc list-inside">
                {reading.elapsed_missing.map((missing) => (
                  <li key={missing}>{t(`souls.detail.reading.elapsed_missing_${missing.toLowerCase()}`)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface RoadProps {
  label: string;
  count: number;
  /** Always `count` — declared rather than assumed, so the day a road stops
   *  being a tally of deeds the change has to be made here and is visible. */
  quantity: QuantityKind;
  detail: string;
}

/** The three columns every row of the fork is laid on. The middle one is the
 *  gutter — a real column with a width, not the boundary between two cells.
 *  That distinction is the whole reason the connector below can be drawn
 *  without putting a line in the gap between the two counts. */
const FORK_COLUMNS = "grid grid-cols-[1fr_10px_1fr]";

/** One hairline, in the one place hairlines are allowed inside the fork. */
const FORK_LINE = "absolute border-[hsl(var(--color-hairline))]";

// The fork itself: the rule that governs both roads, the join where they part,
// and the two roads.
//
// The connector is built from geometry rather than from cell borders, and that
// is a correction rather than a preference. Drawn the obvious way — a
// `border-right` on the left-hand cell — the line lands on the *boundary*
// between the two columns, which is to say in the gap between the two numbers,
// which is exactly the "these two combine" hint the rest of this file exists to
// refuse. So the gap is a column (`FORK_COLUMNS`), the crossbar is inset to the
// two outer columns' centres, and each drop line is centred inside its own
// column. Nothing is ever drawn on a column boundary, and nothing at all is
// drawn beside or between the counts: the connector sits in its own row, above
// them, and the gutter column of the roads row is empty.
//
// `data-fork` / `data-road` / `data-fork-gutter` are here for the tests, which
// assert the structure rather than the pixels — a screenshot cannot say "there
// is no place to put a derived number" but the DOM can.
function Fork({
  rule,
  owed,
  requited,
  t,
}: {
  rule: string;
  owed: RoadProps;
  requited: RoadProps;
  t: TFunc;
}) {
  return (
    <div data-fork="">
      {/* The apex. One rule, above the point where the roads part, because
          615b gives both roads the same measure and this panel states it once. */}
      <p
        data-fork-rule=""
        className="text-xs text-center text-[hsl(var(--color-ink-muted))]"
      >
        {rule}
      </p>

      {/* Geometry only, and therefore aria-hidden: everything it says is said
          in words by the apex above it and the two labels below it. */}
      <div data-fork-connector="" aria-hidden="true" className={`${FORK_COLUMNS} h-4`}>
        <div className="relative">
          <span className={`${FORK_LINE} left-1/2 right-0 top-1/2 border-t`} />
          <span className={`${FORK_LINE} left-1/2 top-1/2 bottom-0 border-l`} />
        </div>
        {/* The gutter, in the connector row only: the stem descending from the
            apex and the middle of the crossbar. Both are above the counts. */}
        <div className="relative">
          <span className={`${FORK_LINE} inset-x-0 top-1/2 border-t`} />
          <span className={`${FORK_LINE} left-1/2 top-0 h-1/2 border-l`} />
        </div>
        <div className="relative">
          <span className={`${FORK_LINE} left-0 right-1/2 top-1/2 border-t`} />
          <span className={`${FORK_LINE} left-1/2 top-1/2 bottom-0 border-l`} />
        </div>
      </div>

      {/* The two roads, and the empty gutter between them. Three cells, and
          there is no fourth: a difference, a sum or a ratio has no cell to sit
          in, and giving it one is a change to this grid that a reviewer sees. */}
      <div className={FORK_COLUMNS}>
        <Road road="owed" t={t} {...owed} />
        <div data-fork-gutter="" />
        <Road road="requited" t={t} {...requited} />
      </div>
    </div>
  );
}

// One road: a label, a count of deeds, and what the count counts.
//
// Extracted so the two roads cannot drift into two different treatments — the
// class strings below are literally the same string on both, which is what the
// tests compare. `count` is rendered as given, including 0.
//
// 0 gets no treatment of its own. An empty right-hand road is an *assessed*
// fact, not an unassessed one: counting MERIT records and counting DEMERIT
// records is the same operation on the same ledger, so "no benefactions" is
// something this system checked and found. Hiding the road would make the
// panel's shape depend on the data and leave a reader unable to tell "no good
// deeds" from "this build has no such field"; styling the zero — dimming it,
// greying it, marking it — would re-introduce a verdict through emphasis, which
// is the same mistake as colouring the roads and is refused for the same
// reason. So the structure is always drawn and the zero is drawn like any
// other number.
//
// The count is a `count`, and that is the half of the review's pair that needed
// no new copy: the caption directly beneath already names what is being counted
// (桩在案过错 / recorded wrongs), so the road says what it is without borrowing
// the weight scale culpa now carries. Both roads pass the same kind through, so
// the two remain literally the same class string — which is what the tests
// compare, and what a marker on one road alone would break.
function Road({ road, label, count, quantity, detail, t }: RoadProps & { road: string; t: TFunc }) {
  return (
    <div data-road={road} className="flex flex-col items-center text-center">
      <span className="text-sm text-[hsl(var(--color-ink-muted))]">{label}</span>
      <Figure
        field={road === "owed" ? "wrongs" : "benefactions"}
        quantity={quantity}
        t={t}
        numeralProps={{ "data-road-count": road }}
        className="text-xl font-bold tabular-nums text-[hsl(var(--color-ink))]"
      >
        {count}
      </Figure>
      <span className="text-xs text-[hsl(var(--color-ink-subtle))] mt-0.5">{detail}</span>
    </div>
  );
}

// ── A kind this build has never heard of ────────────────────────────────
//
// Not a reading, a report that one could not be drawn. The alternative is what
// this component was written to end: returning nothing and letting the card sit
// empty, which looks identical to a soul with no ledger and tells nobody that a
// payload arrived. The kind is printed because it is the one piece of
// information that makes the miss actionable, and because an ugly visible
// string is the failure mode this repository keeps choosing over a silent one.
function UnrenderableReading({ kind, t }: { kind: string; t: TFunc }) {
  return (
    <div
      role="status"
      className="rounded border border-dashed border-[hsl(var(--color-status-warning))] p-3"
    >
      <p className="text-xs text-[hsl(var(--color-status-warning))]">
        {t("souls.detail.reading.unrenderable_kind", { kind })}
      </p>
    </div>
  );
}

// ── UNAVAILABLE — an unmapped tenant gets a refusal, not a borrowed reading ──
function UnavailableReading({
  reasonCode,
  meritScore,
  demeritScore,
  karmicBalance,
  t,
}: {
  reasonCode: UnavailableReasonCode;
  meritScore: number;
  demeritScore: number;
  karmicBalance: number;
  t: TFunc;
}) {
  // Both strings are keyed on the code rather than being the flat
  // `unavailable_explanation` / `unavailable_cta` they used to be. A second
  // cause of UNAVAILABLE would have inherited the first one's wording without
  // anything failing; keyed, it shows the raw key until somebody writes copy.
  const slug = reasonCode.toLowerCase();

  return (
    <div className="space-y-3">
      <p className="text-sm text-[hsl(var(--color-ink-muted))]">
        {t(`souls.detail.reading.unavailable_${slug}_explanation`)}
      </p>

      {/* Plain data, not a reading — neutral ink, no merit/demerit greens
          and reds, no "balance" framing. Those colors are what the other
          three readings use to render a verdict, and this state has none.

          Still magnitudes, though, and marked as such. `LedgerSummary`'s three
          sums are the same SoulRecord.weight totals the BALANCE panel reads;
          neutral ink says "no verdict here", which is a different statement
          from "these are not weights". A reader who scrolls from a Greek soul's
          road count to this box is making exactly the comparison the review
          caught, and the box is the place it is least defended against. */}
      <div className="rounded border border-dashed border-[hsl(var(--color-hairline))] p-3 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-[hsl(var(--color-ink-subtle))]">
          {t("souls.detail.reading.unavailable_raw_data")}
        </p>
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.merit")}</span>
          <Figure field="merit_score" quantity="magnitude" t={t} className="tabular-nums text-[hsl(var(--color-ink))]">
            {meritScore}
          </Figure>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.demerit")}</span>
          <Figure field="demerit_score" quantity="magnitude" t={t} className="tabular-nums text-[hsl(var(--color-ink))]">
            {demeritScore}
          </Figure>
        </div>
        <div className="flex justify-between text-sm border-t border-[hsl(var(--color-hairline))] pt-1">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
          <Figure field="karmic_balance" quantity="magnitude" t={t} className="tabular-nums text-[hsl(var(--color-ink))]">
            {karmicBalance}
          </Figure>
        </div>
      </div>

      <p className="text-xs text-[hsl(var(--color-status-warning))]">
        {t(`souls.detail.reading.unavailable_${slug}_cta`)}
      </p>
    </div>
  );
}
