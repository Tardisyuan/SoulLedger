"use client";

import type { LedgerReading } from "@/lib/api/ledger";
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
 * backend/apps/ledger/readings.py. Four mechanically different shapes
 * behind `reading.kind`, not one net-balance number rendered four ways:
 * netting merit against demerit is the Chinese instrument specifically,
 * and showing it under an Egyptian or European verdict would let a
 * familiar-looking number quietly overrule the actual reading.
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
    case "UNAVAILABLE":
      return (
        <UnavailableReading
          meritScore={meritScore}
          demeritScore={demeritScore}
          karmicBalance={karmicBalance}
          t={t}
        />
      );
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
          <span className="text-xl font-bold text-[hsl(var(--color-ink-subtle))]" aria-label={t("souls.detail.reading.poena_unavailable_heading")}>
            —
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
          {t("souls.detail.reading.poena_unavailable_heading")}
        </p>
        <ul className="text-[11px] text-[hsl(var(--color-ink-subtle))] mt-2 space-y-0.5 list-disc list-inside">
          <li>{t("souls.detail.reading.poena_missing_absolution")}</li>
          <li>{t("souls.detail.reading.poena_missing_satisfaction")}</li>
          <li>{t("souls.detail.reading.poena_missing_penance")}</li>
        </ul>
      </div>
    </div>
  );
}

// ── UNAVAILABLE — an unmapped tenant gets a refusal, not a borrowed reading ──
function UnavailableReading({
  meritScore,
  demeritScore,
  karmicBalance,
  t,
}: {
  meritScore: number;
  demeritScore: number;
  karmicBalance: number;
  t: TFunc;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.reading.unavailable_explanation")}</p>

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

      <p className="text-xs text-[hsl(var(--color-status-warning))]">{t("souls.detail.reading.unavailable_cta")}</p>
    </div>
  );
}
