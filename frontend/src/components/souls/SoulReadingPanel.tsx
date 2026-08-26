"use client";

import type { LedgerReading, UnavailableReasonCode } from "@/lib/api/ledger";
import { READING_QUANTITIES, SUMMARY_QUANTITIES } from "@/lib/api/ledgerQuantities";
import { Figure } from "@/src/components/ledger/QuantityFigure";
// The Greek fork — its geometry, and the long argument for why the two roads
// have no cell to be combined in — lives in its own module. It is the one
// branch whose *layout* is the load-bearing part, so it is the one worth
// reading on its own.
import { SentenceReading } from "@/src/components/souls/SoulSentenceReading";
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

// The figure primitive lives in `src/components/ledger/QuantityFigure.tsx`
// now, because the same numbers are drawn directly beneath this panel (the
// raw/decayed breakdown in `SoulKarmaLedgerCard`) and again in the judgment
// queue's triage card. See that file for why the marker names a scale rather
// than a unit, and why it is not `aria-hidden`.

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
        <span className="text-04 text-[hsl(var(--color-karma-merit))]">{t("souls.detail.merit")}</span>
        <Figure
          field="merit"
          quantity={q.merit}
          t={t}
          className="text-06 tabular-nums text-[hsl(var(--color-karma-merit))]"
        >
          +{reading.merit}
        </Figure>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-04 text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.demerit")}</span>
        <Figure
          field="demerit"
          quantity={q.demerit}
          t={t}
          className="text-06 tabular-nums text-[hsl(var(--color-karma-demerit))]"
        >
          -{reading.demerit}
        </Figure>
      </div>
      <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
        <span className="text-04 text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
        <Figure
          field="balance"
          quantity={q.balance}
          t={t}
          className={`text-06 tabular-nums ${
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
          className={`text-07 tabular-nums ${
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
        <span className="text-02 text-[hsl(var(--color-ink-muted))] mt-1 text-center">
          {t("souls.detail.reading.threshold_hint", {
            weight: String(reading.heart_weight),
            counterweight: String(reading.counterweight),
            scale: t("ledger.figure_scale_weight"),
          })}
        </span>
      </div>
      <div className="flex justify-center">
        <span
          className={`px-2 py-0.5 rounded text-02 font-bold ${
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
          <span className="text-04 text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.reading.culpa_label")}</span>
          <Figure
            field="culpa"
            quantity={READING_QUANTITIES.GUILT_AND_PENALTY.culpa}
            t={t}
            className="text-06 tabular-nums text-[hsl(var(--color-karma-demerit))]"
          >
            {reading.culpa}
          </Figure>
        </div>
        {/* `culpa_record_count` is classified a count and deliberately stays in
            this sentence: a second numeral of culpa's size beside culpa is the
            confusion, not the fix. */}
        <div className="text-02 text-[hsl(var(--color-ink-subtle))] text-right mt-0.5">
          {t("souls.detail.reading.culpa_records", { count: String(reading.culpa_record_count) })}
        </div>
      </div>

      {/* Visually separated from culpa on purpose — a dashed rule, a
          neutral em-dash instead of a number, and no shared axis with the
          figure above. Poena is an honest absence, not a zero, and it must
          never read as something that offsets or compares against culpa. */}
      <div className="border-t border-dashed border-[hsl(var(--color-hairline))] pt-3">
        <div className="flex justify-between items-center">
          <span className="text-04 text-[hsl(var(--color-ink-muted))]">{t("souls.detail.reading.poena_label")}</span>
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
            className="text-06 text-[hsl(var(--color-ink-subtle))]"
            aria-hidden="true"
          >
            —
          </span>
        </div>
        <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">
          {t("souls.detail.reading.poena_unavailable_heading")}
        </p>
        {/* One bullet per member the backend actually sent, not three
            hard-coded ones. `poena_missing` is the list readings.py builds the
            absence out of; rendering a fixed three meant a fourth missing
            input would have been dropped with nothing going red. The key is
            derived from the member so a member with no copy shows the raw key
            — ugly, and therefore self-reporting — instead of vanishing. */}
        {reading.poena_missing.length > 0 && (
          <ul className="text-02 text-[hsl(var(--color-ink-subtle))] mt-2 space-y-0.5 list-disc list-inside">
            {reading.poena_missing.map((missing) => (
              <li key={missing}>{t(`souls.detail.reading.poena_missing_${missing.toLowerCase()}`)}</li>
            ))}
          </ul>
        )}
      </div>
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
      <p className="text-02 text-[hsl(var(--color-status-warning))]">
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
      <p className="text-04 text-[hsl(var(--color-ink-muted))]">
        {t(`souls.detail.reading.unavailable_${slug}_explanation`)}
      </p>

      {/* Plain data, not a reading — neutral ink, no merit/demerit greens
          and reds, no "balance" framing. Those colors are what the other
          three readings use to render a verdict, and this state has none.

          Still magnitudes, though, and marked as such — read off
          `SUMMARY_QUANTITIES` rather than written in by hand here, because
          these are that payload's fields and a classification typed at the
          call site is a fourth copy of an answer three tables already give.
          `LedgerSummary`'s three sums are the same SoulRecord.weight totals
          the BALANCE panel reads;
          neutral ink says "no verdict here", which is a different statement
          from "these are not weights". A reader who scrolls from a Greek soul's
          road count to this box is making exactly the comparison the review
          caught, and the box is the place it is least defended against. */}
      <div className="rounded border border-dashed border-[hsl(var(--color-hairline))] p-3 space-y-1.5">
        <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">
          {t("souls.detail.reading.unavailable_raw_data")}
        </p>
        <div className="flex justify-between text-03">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.merit")}</span>
          <Figure field="merit_score" quantity={SUMMARY_QUANTITIES.merit_score} t={t} className="tabular-nums text-[hsl(var(--color-ink))]">
            {meritScore}
          </Figure>
        </div>
        <div className="flex justify-between text-03">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.demerit")}</span>
          <Figure field="demerit_score" quantity={SUMMARY_QUANTITIES.demerit_score} t={t} className="tabular-nums text-[hsl(var(--color-ink))]">
            {demeritScore}
          </Figure>
        </div>
        <div className="flex justify-between text-03 border-t border-[hsl(var(--color-hairline))] pt-1">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
          <Figure field="karmic_balance" quantity={SUMMARY_QUANTITIES.karmic_balance} t={t} className="tabular-nums text-[hsl(var(--color-ink))]">
            {karmicBalance}
          </Figure>
        </div>
      </div>

      <p className="text-02 text-[hsl(var(--color-status-warning))]">
        {t(`souls.detail.reading.unavailable_${slug}_cta`)}
      </p>
    </div>
  );
}
