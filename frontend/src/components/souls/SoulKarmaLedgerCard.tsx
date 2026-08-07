"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { LazyLifespanBarChart } from "@/src/components/charts/LazyDashboardCharts";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";
import type { LedgerReading, LedgerRecord, LedgerInheritance } from "@/lib/api/ledger";
import type { HistoricalDate } from "@/lib/utils";

// Fixed policy constants from apps/ledger/services.py (INHERITANCE_MERIT /
// INHERITANCE_DEMERIT) — not returned by the API, but a stable, deliberately
// documented design constant (merit thins to a fifth on rebirth, demerit
// carries at full strength), safe to mirror here as static copy rather than
// a live-fetched number.
const INHERITANCE_MERIT_PCT = 20;
const INHERITANCE_DEMERIT_PCT = 100;

interface SoulKarmaLedgerCardProps {
  ledgerLabel: string;
  reading: LedgerReading;
  /** Decayed totals from LedgerSummary — despite the field names, these are
   * time-decayed sums (LedgerService.get_ledger_summary sums effective_weight,
   * not weight), not raw ones. Raw totals are derived from `records` below. */
  meritScore: number;
  demeritScore: number;
  karmicBalance: number;
  recordCount: number;
  records: LedgerRecord[];
  inheritance: LedgerInheritance | null;
}

type TFunc = (key: string, params?: Record<string, string>) => string;

function tfFactory(t: TFunc): (key: string, fallback: string, params?: Record<string, string>) => string {
  return (key, fallback, params) => {
    if (t(key) === key) {
      return params
        ? Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), fallback)
        : fallback;
    }
    return t(key, params);
  };
}

/** Year-only label for the x-axis — full formatHistoricalDate also appends
 * month/day, which is too wide for a per-record bar-chart tick. */
function yearLabel(date: HistoricalDate | null, fallbackIso: string): string {
  if (date) return date.year <= 0 ? `${Math.abs(date.year)} BCE` : `${date.year}`;
  return fallbackIso.slice(0, 4);
}

/** Chronological sort key: real event date when known, else when it was
 * recorded — same fallback getLedgerChartData used, just working from the
 * structured HistoricalDate instead of round-tripping a formatted string. */
function sortKey(r: LedgerRecord): number {
  if (r.event_date) {
    const { year, month, day } = r.event_date;
    return year * 372 + (month ?? 0) * 31 + (day ?? 0);
  }
  return new Date(r.recorded_at).getTime() / 86_400_000 + 10_000_000; // days, biased above any plausible year*372
}

function getLifespanChartData(records: LedgerRecord[]) {
  return [...records]
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map((r) => {
      const sign = r.type === "MERIT" ? 1 : -1;
      const effective = sign * r.effective_weight;
      const original = sign * r.original_weight;
      return {
        key: r.id,
        label: yearLabel(r.event_date, r.recorded_at),
        effective,
        decayedAway: original - effective,
        color: r.type === "MERIT" ? "hsl(var(--color-karma-merit))" : "hsl(var(--color-karma-demerit))",
      };
    });
}

/**
 * Left column of the Stage 3 soul lifecycle layout — 业力总账. Wraps the
 * existing (unchanged) SoulReadingPanel with the cosmology-specific reading,
 * then adds the universal raw-vs-decayed breakdown, the lifespan bar chart,
 * and (when the API has a forward preview) the next-life inheritance card.
 *
 * `reading` stays the headline framing — netting merit against demerit is a
 * Chinese-specific instrument, not something to imply for every cosmology —
 * the raw/decayed section below it is deliberately neutral, plain-data
 * styling, same rationale as UnavailableReading in SoulReadingPanel.
 */
export function SoulKarmaLedgerCard({
  ledgerLabel,
  reading,
  meritScore,
  demeritScore,
  karmicBalance,
  recordCount,
  records,
  inheritance,
}: SoulKarmaLedgerCardProps) {
  const { t } = useI18n();
  const tf = tfFactory(t);

  const rawMerit = records.filter((r) => r.type === "MERIT").reduce((s, r) => s + r.original_weight, 0);
  const rawDemerit = records.filter((r) => r.type === "DEMERIT").reduce((s, r) => s + r.original_weight, 0);
  const rawBalance = rawMerit - rawDemerit;

  return (
    <div className="space-y-6">
      {/* 业力总账 */}
      <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
        <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{ledgerLabel}</h2>

        <SoulReadingPanel
          reading={reading}
          meritScore={meritScore}
          demeritScore={demeritScore}
          karmicBalance={karmicBalance}
        />

        <div className="mt-4 pt-3 border-t border-[hsl(var(--color-hairline))] space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-[hsl(var(--color-ink-subtle))] mb-1.5">
            {tf("ledger.raw_vs_decayed", "原始 / 衰减后")}
          </p>
          <div className="flex justify-between text-xs">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.raw_merit", "原始 功德")}</span>
            <span className="text-[hsl(var(--color-karma-merit))]">+{rawMerit}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.raw_demerit", "原始 罪业")}</span>
            <span className="text-[hsl(var(--color-karma-demerit))]">-{rawDemerit}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.decayed_merit", "衰减后 功德")}</span>
            <span className="text-[hsl(var(--color-karma-merit))]">+{meritScore}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.decayed_demerit", "衰减后 罪业")}</span>
            <span className="text-[hsl(var(--color-karma-demerit))]">-{demeritScore}</span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
            <span
              className={`text-lg font-bold ${
                karmicBalance >= 0 ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"
              }`}
            >
              {karmicBalance >= 0 ? "+" : ""}
              {karmicBalance}
            </span>
          </div>
          {/* rawBalance is computed but intentionally not re-shown as a second
              big number here — 余额 above is the decayed balance the cosmology
              actually reads (see `reading` above it); showing two "balance"
              figures the same size would make it look like a discrepancy to
              resolve rather than two honest views of the same ledger. */}
          <p className="sr-only">{tf("ledger.raw_balance_sr", "原始余额 {{n}}", { n: String(rawBalance) })}</p>

          <div className="rounded border border-dashed border-[hsl(var(--color-hairline))] p-2 mt-2">
            <p className="text-[11px] text-[hsl(var(--color-ink-subtle))]">
              {tf(
                "ledger.advisory_disclaimer",
                "仅供裁决参考 · 业力不参与判定计算，裁决由判官作出"
              )}
            </p>
          </div>
        </div>

        <div className="text-xs text-[hsl(var(--color-ink-subtle))] text-right mt-3">
          {recordCount} {t("souls.detail.records")}
        </div>

        {records.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-[hsl(var(--color-ink-muted))] mb-2">{t("ledger.timeline")}</p>
            <LazyLifespanBarChart data={getLifespanChartData(records)} />
          </div>
        )}
      </div>

      {/* 下一世继承 — only when the API actually has a forward preview (a
          409/REBIRTH_NOT_APPLICABLE for a terminal cosmology resolves this to
          null; see ledgerApi.inheritance's caller in page.tsx). */}
      {inheritance && (
        <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
          <p className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
            {t("ledger.next_life_inheritance")}
          </p>
          <div className="flex justify-between text-xs">
            <span className="text-[hsl(var(--color-karma-merit))]">{t("souls.detail.merit")}: +{inheritance.inherited_merit}</span>
            <span className="text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.demerit")}: -{inheritance.inherited_demerit}</span>
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-[hsl(var(--color-ink-subtle))]">{t("souls.detail.balance")}: </span>
            <span
              className={
                inheritance.inherited_merit - inheritance.inherited_demerit >= 0
                  ? "text-[hsl(var(--color-karma-merit))]"
                  : "text-[hsl(var(--color-karma-demerit))]"
              }
            >
              {inheritance.inherited_merit - inheritance.inherited_demerit >= 0 ? "+" : ""}
              {inheritance.inherited_merit - inheritance.inherited_demerit}
            </span>
          </div>
          <p className="text-[10px] text-[hsl(var(--color-ink-subtle))] mt-2">
            {tf("ledger.carry_forward_rate", "承前 {{merit}}% 功德 · {{demerit}}% 罪业", {
              merit: String(INHERITANCE_MERIT_PCT),
              demerit: String(INHERITANCE_DEMERIT_PCT),
            })}
          </p>
          <p className="text-[10px] text-[hsl(var(--color-ink-subtle))] mt-1">{t("ledger.inheritance_note")}</p>
        </div>
      )}
    </div>
  );
}
