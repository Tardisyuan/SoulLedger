"use client";

import type { LedgerReading, UnavailableReasonCode } from "@/lib/api/ledger";
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

// ── CHINESE (功过格) — a cumulative net account ──────────────────────
function BalanceReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "BALANCE" }>;
  t: TFunc;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-[hsl(var(--color-karma-merit))]">{t("souls.detail.merit")}</span>
        <span className="text-lg font-bold text-[hsl(var(--color-karma-merit))]">+{reading.merit}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.demerit")}</span>
        <span className="text-lg font-bold text-[hsl(var(--color-karma-demerit))]">-{reading.demerit}</span>
      </div>
      <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
        <span className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
        <span
          className={`text-xl font-bold ${
            reading.balance >= 0 ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"
          }`}
        >
          {reading.balance >= 0 ? "+" : ""}
          {reading.balance}
        </span>
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
        <span
          className={`text-3xl font-bold tabular-nums ${
            failed ? "text-[hsl(var(--color-status-error))]" : "text-[hsl(var(--color-karma-merit))]"
          }`}
        >
          {ratioText}
        </span>
        <span className="text-xs text-[hsl(var(--color-ink-muted))] mt-1 text-center">
          {t("souls.detail.reading.threshold_hint", {
            weight: String(reading.heart_weight),
            counterweight: String(reading.counterweight),
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
        <div className="flex justify-between items-center">
          <span className="text-sm text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.reading.culpa_label")}</span>
          <span className="text-xl font-bold text-[hsl(var(--color-karma-demerit))]">{reading.culpa}</span>
        </div>
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
              failure mode this position has to avoid. */}
          <span className="text-xl font-bold text-[hsl(var(--color-ink-subtle))]" aria-hidden="true">
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

// ── GREEK (千年轮回) — a term owed, and a term served that nobody recorded ──
//
// Deliberately the same visual grammar as GuiltAndPenaltyReading above: a known
// figure, then a dashed rule, then an em-dash where a number would go. The two
// readings are the same problem — one fact the ledger holds and one it does not
// — and this repository has already argued out how to draw that once. Drawing
// it a second way would invite the reader to think the two absences differ.
//
// What is deliberately NOT here:
//   * `wrongs × repayment_multiple` as a figure. Tenfold repayment is the rule
//     Republic X states, not a balance it computes; printing "40" for four
//     wrongs would read as "owes 40", a quantity no source asserts and this
//     system has no unit for. The two numbers are shown side by side instead
//     and the reader is left to hold them as what they are.
//   * a progress bar or a percentage. The denominator is a term length nobody
//     has computed and the numerator is `elapsed_years`, which is null. A bar
//     would have to invent both.
//   * `circuit_years` as a headline. 1000 is the length of one circuit — the
//     unit the repayment is reckoned in — and rendering it large next to the
//     word "sentence" would say this soul was sentenced to a thousand years.
function SentenceReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "SENTENCE" }>;
  t: TFunc;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-[hsl(var(--color-karma-demerit))]">
            {t("souls.detail.reading.sentence_owed_label")}
          </span>
          <span className="text-xl font-bold text-[hsl(var(--color-karma-demerit))] tabular-nums">
            {reading.wrongs}
          </span>
        </div>
        <div className="text-xs text-[hsl(var(--color-ink-subtle))] text-right mt-0.5">
          {t("souls.detail.reading.sentence_owed_detail", {
            multiple: String(reading.repayment_multiple),
          })}
        </div>
        <p className="text-[11px] text-[hsl(var(--color-ink-subtle))] mt-1">
          {t("souls.detail.reading.sentence_circuit", { years: String(reading.circuit_years) })}
        </p>
      </div>

      {/* Same dashed rule, em-dash and absent shared axis as poena, and for the
          same reason: time served is not zero, it is unknown. A 0 here would
          be a claim that the term has not begun, which is a fact about a
          sentence and not a fact this ledger holds. */}
      <div className="border-t border-dashed border-[hsl(var(--color-hairline))] pt-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-[hsl(var(--color-ink-muted))]">
            {t("souls.detail.reading.sentence_elapsed_label")}
          </span>
          {/* aria-hidden for the same reason as the poena slot above. */}
          <span className="text-xl font-bold text-[hsl(var(--color-ink-subtle))]" aria-hidden="true">
            —
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
          {t("souls.detail.reading.elapsed_unavailable_heading")}
        </p>
        {/* One bullet per member the backend sent, key derived from the member,
            exactly as the poena list does it — including the failure mode: a
            member with no copy shows its raw key rather than vanishing. */}
        {reading.elapsed_missing.length > 0 && (
          <ul className="text-[11px] text-[hsl(var(--color-ink-subtle))] mt-2 space-y-0.5 list-disc list-inside">
            {reading.elapsed_missing.map((missing) => (
              <li key={missing}>{t(`souls.detail.reading.elapsed_missing_${missing.toLowerCase()}`)}</li>
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
          three readings use to render a verdict, and this state has none. */}
      <div className="rounded border border-dashed border-[hsl(var(--color-hairline))] p-3 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-[hsl(var(--color-ink-subtle))]">
          {t("souls.detail.reading.unavailable_raw_data")}
        </p>
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.merit")}</span>
          <span className="text-[hsl(var(--color-ink))]">{meritScore}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.demerit")}</span>
          <span className="text-[hsl(var(--color-ink))]">{demeritScore}</span>
        </div>
        <div className="flex justify-between text-sm border-t border-[hsl(var(--color-hairline))] pt-1">
          <span className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
          <span className="text-[hsl(var(--color-ink))]">{karmicBalance}</span>
        </div>
      </div>

      <p className="text-xs text-[hsl(var(--color-status-warning))]">
        {t(`souls.detail.reading.unavailable_${slug}_cta`)}
      </p>
    </div>
  );
}
