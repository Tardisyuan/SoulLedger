"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { LazyLifespanBarChart } from "@/src/components/charts/LazyDashboardCharts";
import { Figure } from "@/src/components/ledger/QuantityFigure";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";
import type { LedgerReading, LedgerRecord, LedgerInheritance } from "@/lib/api/ledger";
import {
  INHERITANCE_QUANTITIES,
  RECORD_QUANTITIES,
  SUMMARY_QUANTITIES,
} from "@/lib/api/ledgerQuantities";
import type { HistoricalDate } from "@/lib/utils";

/** A rate from the inheritance payload, as the whole-number percentage the
 * bars and the caption both want.
 *
 * These used to be two literals here — `INHERITANCE_MERIT_PCT = 20` and
 * `INHERITANCE_DEMERIT_PCT = 100` — mirroring INHERITANCE_MERIT /
 * INHERITANCE_DEMERIT in apps/ledger/services.py, on the argument that a
 * deliberately documented constant is safe to copy. It was not: the backend
 * was *also* composing an English sentence out of the same two constants, and
 * the message bundles carried a third version of the claim that had already
 * gone stale ("Merit and demerit pass to the next incarnation", which describes
 * the symmetric 0.2/0.2 policy that no longer exists). The endpoint now returns
 * the rates, so there is one source and the copy is a translation of it. */
function ratePct(rate: number): number {
  return Math.round(rate * 100);
}

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
      <div className="bg-[hsl(var(--color-surface-1))] p-5 border border-[hsl(var(--color-hairline))]">
        <h2 className="text-01 text-[hsl(var(--color-ink-muted))] uppercase mb-3">{ledgerLabel}</h2>

        <SoulReadingPanel
          reading={reading}
          meritScore={meritScore}
          demeritScore={demeritScore}
          karmicBalance={karmicBalance}
        />

        <div className="mt-4 pt-3 border-t border-[hsl(var(--color-hairline))] space-y-1.5">
          <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-1.5">
            {tf("ledger.raw_vs_decayed", "原始 / 衰减后")}
          </p>
          {/* Five weight sums, and until now five bare numerals — directly under
              a reading panel whose figures name the scale they are on. Adjacent
              is the worst place to be inconsistent: a marked figure above an
              unmarked one does not read as "one of these names its scale", it
              reads as "these are different quantities", which is the exact
              misreading `185e70c` set out to end one card higher up.

              The raw pair take their kind from `original_weight`, the field
              they are sums of, rather than from a literal typed here; the
              decayed pair and the balance are `LedgerSummary`'s own fields and
              take theirs from that payload's table. */}
          <div className="flex justify-between text-02">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.raw_merit", "原始 功德")}</span>
            <Figure
              field="raw_merit"
              quantity={RECORD_QUANTITIES.original_weight}
              t={t}
              className="tabular-nums text-[hsl(var(--color-karma-merit))]"
            >
              +{rawMerit}
            </Figure>
          </div>
          <div className="flex justify-between text-02">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.raw_demerit", "原始 罪业")}</span>
            <Figure
              field="raw_demerit"
              quantity={RECORD_QUANTITIES.original_weight}
              t={t}
              className="tabular-nums text-[hsl(var(--color-karma-demerit))]"
            >
              -{rawDemerit}
            </Figure>
          </div>
          <div className="flex justify-between text-02">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.decayed_merit", "衰减后 功德")}</span>
            <Figure
              field="merit_score"
              quantity={SUMMARY_QUANTITIES.merit_score}
              t={t}
              className="tabular-nums text-[hsl(var(--color-karma-merit))]"
            >
              +{meritScore}
            </Figure>
          </div>
          <div className="flex justify-between text-02">
            <span className="text-[hsl(var(--color-ink-muted))]">{tf("ledger.decayed_demerit", "衰减后 罪业")}</span>
            <Figure
              field="demerit_score"
              quantity={SUMMARY_QUANTITIES.demerit_score}
              t={t}
              className="tabular-nums text-[hsl(var(--color-karma-demerit))]"
            >
              -{demeritScore}
            </Figure>
          </div>
          {/* WHY THE BALANCE ROW IS THE ONLY PART OF THIS BLOCK THAT IS GUARDED.
              The four rows above are raw-against-decayed, which is a fact about
              `SoulRecord.weight` and true whatever cosmology reads it. A balance
              is not: netting merit against demerit is the 功過格's instrument
              specifically, and `karmic_balance` is — in its own backend words —
              "the Chinese reading served to everyone" (services.py:118).

              Unguarded, this row undid the panel directly above it. An Egyptian
              soul rendered「重于费斯之羽」and then, one row down in bold green,
              「余额 +6 权重」— a heart carrying 18 points of wrongdoing reading
              as passing once 24 points of merit were subtracted from it. That
              subtraction is the exact failure `_egyptian_reading`'s docstring
              was written about, and the Hall of Two Truths has no offsetting
              step for it to be the result of. The refusal was stated in the
              backend, restated in the panel, and then taken back here by a
              block that had never heard of it.

              `reading.kind === "BALANCE"` and not `civilization === "CHINESE"`
              like the inheritance bars below: the bars are a rebirth mechanic
              that belongs to a named cosmology, whereas this row exists because
              the panel above nets — and the panel nets exactly when the kind is
              BALANCE. A fifth cosmology reading a balance should get this row
              without anyone remembering to add its tenant name here.

              The sr-only raw balance goes with it. It reads out a netted sum
              too, so leaving it behind would have kept the same claim and only
              moved it to where a sighted reviewer could not see it. Its own
              reason for being unseen still stands where it is drawn: rawBalance
              is computed and deliberately not shown as a second big number,
              because two same-sized balances read as a discrepancy to resolve
              rather than two honest views of one ledger. */}
          {reading.kind === "BALANCE" && (
            <>
              <div className="flex justify-between items-center pt-1">
                <span className="text-04 text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
                <Figure
                  field="karmic_balance"
                  quantity={SUMMARY_QUANTITIES.karmic_balance}
                  t={t}
                  className={`text-06 tabular-nums ${
                    karmicBalance >= 0 ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"
                  }`}
                >
                  {karmicBalance >= 0 ? "+" : ""}
                  {karmicBalance}
                </Figure>
              </div>
              <p className="sr-only">{tf("ledger.raw_balance_sr", "原始余额 {{n}}", { n: String(rawBalance) })}</p>
            </>
          )}

          <div className="border border-dashed border-[hsl(var(--color-hairline))] p-2 mt-2">
            <p className="text-02 text-[hsl(var(--color-ink-subtle))]">
              {tf(
                "ledger.advisory_disclaimer",
                "仅供裁决参考 · 业力不参与判定计算，裁决由判官作出"
              )}
            </p>
          </div>
        </div>

        {/* A count, classified as one in SUMMARY_QUANTITIES and deliberately not
            a figure: it already carries its noun ("12 条记录"), which is what
            every count on screen does and what no magnitude can do. Promoting it
            to a numeral beside the weight sums above is the confusion, not the
            fix — the same call `culpa_record_count` gets one card higher. */}
        <div className="text-02 text-[hsl(var(--color-ink-subtle))] text-right mt-3">
          {recordCount} {t("souls.detail.records")}
        </div>

        {records.length > 0 && (
          <div className="mt-4">
            <p className="text-02 text-[hsl(var(--color-ink-muted))] mb-2">{t("ledger.timeline")}</p>
            <LazyLifespanBarChart data={getLifespanChartData(records)} />
          </div>
        )}
      </div>

      {/* 下一世继承 — only when the API actually has a forward preview (a
          409/REBIRTH_NOT_APPLICABLE for a terminal cosmology resolves this to
          null; see ledgerApi.inheritance's caller in page.tsx). */}
      {inheritance && (
        <div className="bg-[hsl(var(--color-surface-1))] p-5 border border-[hsl(var(--color-hairline))]">
          <p className="text-01 text-[hsl(var(--color-ink-muted))] uppercase mb-3">
            {t("ledger.next_life_inheritance")}
          </p>

          {/* Dual ratio bars — Chinese-specific, per Stage 5 §5: reincarnation
              with partial-merit/full-demerit carryover is that cosmology's
              mechanic, not a universal one (see SoulReadingPanel's `kind`
              switch for the same civilization-conditional pattern). A single
              number can't distinguish a 20% carry from a 100% one; two bars
              at a glance can. `inheritance` is non-null wherever the backend
              has a forward preview, which since f92ed35 is CHINESE *and*
              GREEK — REBIRTH_CAPABLE_CIVILIZATIONS gained the Spindle of
              Necessity (Republic X 617d-620d). This comment used to say
              "today: Chinese only"; it was true when written and stopped being
              true without anything going red. The explicit check is what
              stopped that from silently handing a Greek soul the Chinese
              rendering — the caption below it still reports whatever rates the
              API applied, which is a statement about this system's arithmetic
              rather than a claim about Plato. */}
          {/* WHY THE TWO NUMBERS IN EACH BAR CAPTION ARE NOT FIGURES. What this
              block draws is a *rate* — `inheritance_merit_rate`, classified a
              ratio — and the two numerals are the operands it acts on, printed
              as the bar's endpoints. That is the Egyptian headline's shape
              exactly: the ratio is the figure, and `heart_weight` and
              `counterweight` stay in the hint beside it rather than becoming
              numerals of their own. Marking four endpoints inside a two-line
              graphic would print the scale word four times to say what the three
              rows below already say once each — and both operands are marked
              elsewhere on this same card, `meritScore` in the block above and
              `inherited_merit` in the row below.

              `data-inheritance-bars` is here for the contract test, which pins
              that this subtree draws no classified figure at all. Without it the
              decision above is a paragraph, and a paragraph is what gets
              overtaken. */}
          {reading.civilization === "CHINESE" && (
            <div data-inheritance-bars="" className="space-y-2.5 mb-3">
              <div>
                <div className="flex justify-between text-02 font-mono text-[hsl(var(--color-karma-merit))] mb-1">
                  <span>{t("souls.detail.merit")} {meritScore}</span>
                  <span>→ {inheritance.inherited_merit}</span>
                </div>
                <div className="h-2 rounded-full bg-[hsl(var(--color-karma-merit)/0.18)] overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-[hsl(var(--color-karma-merit))]"
                    style={{ width: `${ratePct(inheritance.inheritance_merit_rate)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-02 font-mono text-[hsl(var(--color-karma-demerit))] mb-1">
                  <span>{t("souls.detail.demerit")} {demeritScore}</span>
                  <span>→ {inheritance.inherited_demerit}</span>
                </div>
                <div className="h-2 rounded-full bg-[hsl(var(--color-karma-demerit)/0.18)] overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-[hsl(var(--color-karma-demerit))]"
                    style={{ width: `${ratePct(inheritance.inheritance_demerit_rate)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* The three numerals every cosmology with a forward preview gets, and
              the only figures in this card. Two are the payload's own sums and
              take their kind from INHERITANCE_QUANTITIES; the third is their
              difference, and a difference of magnitudes is still a magnitude —
              the same argument BALANCE makes about netting merit against
              demerit, which is why this row exists only where a next life
              does. */}
          <div className="flex justify-between text-02">
            <span className="inline-flex items-baseline gap-1 text-[hsl(var(--color-karma-merit))]">
              <span>{t("souls.detail.merit")}:</span>
              <Figure
                field="inherited_merit"
                quantity={INHERITANCE_QUANTITIES.inherited_merit}
                t={t}
                className="tabular-nums text-[hsl(var(--color-karma-merit))]"
              >
                +{inheritance.inherited_merit}
              </Figure>
            </span>
            <span className="inline-flex items-baseline gap-1 text-[hsl(var(--color-karma-demerit))]">
              <span>{t("souls.detail.demerit")}:</span>
              <Figure
                field="inherited_demerit"
                quantity={INHERITANCE_QUANTITIES.inherited_demerit}
                t={t}
                className="tabular-nums text-[hsl(var(--color-karma-demerit))]"
              >
                -{inheritance.inherited_demerit}
              </Figure>
            </span>
          </div>
          <div className="flex justify-between text-02 mt-1">
            <span className="text-[hsl(var(--color-ink-subtle))]">{t("souls.detail.balance")}: </span>
            <Figure
              field="inherited_balance"
              quantity={INHERITANCE_QUANTITIES.inherited_merit}
              t={t}
              className={`tabular-nums ${
                inheritance.inherited_merit - inheritance.inherited_demerit >= 0
                  ? "text-[hsl(var(--color-karma-merit))]"
                  : "text-[hsl(var(--color-karma-demerit))]"
              }`}
            >
              {inheritance.inherited_merit - inheritance.inherited_demerit >= 0 ? "+" : ""}
              {inheritance.inherited_merit - inheritance.inherited_demerit}
            </Figure>
          </div>
          <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-2">
            {/* Now a real bundle key in all three catalogues rather than a
                Chinese `tf` fallback that shipped untranslated to every
                locale, and the numbers are the API's rather than this file's.

                Both rates are classified `ratio` and reach the screen only
                here and as the bar widths above — never as a figure. A
                fraction drawn as a bold numeral with the weight scale beside
                it would say the *rate* was measured in weight, which is the
                category error the four kinds exist to make impossible; the
                percent sign is the rate's own unit and it is already in the
                sentence. */}
            {t("ledger.carry_forward_rate", {
              merit: String(ratePct(inheritance.inheritance_merit_rate)),
              demerit: String(ratePct(inheritance.inheritance_demerit_rate)),
            })}
          </p>
          <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">{t("ledger.inheritance_note")}</p>
        </div>
      )}
    </div>
  );
}
