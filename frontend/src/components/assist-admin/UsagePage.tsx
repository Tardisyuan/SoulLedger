"use client";

import { useState } from "react";
import type { AssistAdminUsage } from "@soulledger/core/api/assist-admin";
import { useAssistUsage } from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { QueryError } from "@/src/components/ui/PageError";
import { ListSkeleton } from "@/components/ui/skeleton";
import { AssistAdminTabs, MONO, MUTED, SUBTLE, Section, count, money, pct } from "./parts";

/** `ALERT_SHARE` in backend/apps/soul_assist/usage.py. */
const ALERT_SHARE = 0.8;
/** 改用备用's reasons (frame 7a): the first four always, the last two only when they happened. */
const ALWAYS_REASONS = ["connection", "timeout", "rate_limited", "server_error"] as const;
const RARE_REASONS = ["quota", "circuit_open"] as const;
const REASONS = [...ALWAYS_REASONS, ...RARE_REASONS];
/** Frame 7a's backup swatch: ink diagonal hatching, no hue — the backup is not a status. */
const HATCH =
  "bg-[repeating-linear-gradient(135deg,oklch(var(--color-ink))_0_1.5px,transparent_1.5px_4px)] shadow-[inset_0_0_0_1px_oklch(var(--color-ink))]";

export function AssistAdminUsagePage() {
  const { t } = useI18n();
  const [month, setMonth] = useState<string>("");
  const usage = useAssistUsage(month || undefined);
  return (
    <PageShell
      variant="full"
      title={t("assist_admin.title")}
      tabs={<AssistAdminTabs />}
      actions={
        <label className="flex items-center gap-2 text-sm">
          {t("assist_admin.usage.month")}
          <input
            type="month"
            value={month || usage.data?.month || ""}
            onChange={(e) => setMonth(e.target.value)}
            className={`border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-2 py-1 ${MONO}`}
          />
        </label>
      }
      isLoading={usage.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={!usage.data}
      empty={<QueryError onRetry={() => usage.refetch()} />}
    >
      {usage.data && <UsageBody usage={usage.data} />}
    </PageShell>
  );
}

function UsageBody({ usage }: { usage: AssistAdminUsage }) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  const share = usage.cap ? usage.spent / usage.cap : null;
  const p4 = usage.phase4;
  const roleCost = (role: "primary" | "backup") => usage.by_provider.find((r) => r.role === role)?.cost ?? null;
  const primaryCost = roleCost("primary") ?? 0;
  const backupCost = roleCost("backup");

  return (
    <div className="grid gap-x-12 lg:grid-cols-2">
      <div>
        <Section title={t("assist_admin.usage.spent")} id="aa-spent">
          {usage.unpriced_models.length > 0 && (
            <p role="alert" className="mb-3 border-l-2 border-[oklch(var(--color-warning))] pl-3 text-sm">
              {t("assist_admin.usage.unpriced", { models: usage.unpriced_models.join(", ") })}
            </p>
          )}
          <p className={`text-lg ${MONO}`} data-testid="aa-spent">
            {money(usage.spent)} / {usage.cap == null ? t("assist_admin.usage.no_cap") : money(usage.cap)}
            {share != null && <span className={`ml-2 text-sm ${MUTED}`}>{pct(share)}</span>}
          </p>
          {usage.cap != null && (
            <div className="mt-2">
              <div
                role="meter"
                aria-label={t("assist_admin.usage.spent")}
                aria-valuemin={0}
                aria-valuemax={usage.cap}
                aria-valuenow={usage.spent}
                className="relative h-2 bg-[oklch(var(--color-surface-2))]"
              >
                <div className="h-full bg-[oklch(var(--color-accent))]" style={{ width: `${Math.min(share ?? 0, 1) * 100}%` }} />
                <div data-testid="aa-alert-line" aria-hidden="true" className="absolute inset-y-[-3px] w-px bg-[oklch(var(--color-warning))]" style={{ left: `${ALERT_SHARE * 100}%` }} />
              </div>
              <div className={`relative mt-1 h-4 ${SUBTLE} ${MONO}`}>
                <span className="absolute left-0">0</span>
                <span className="absolute -translate-x-1/2" style={{ left: `${ALERT_SHARE * 100}%` }}>
                  {t("assist_admin.usage.alert_mark")}
                </span>
                <span className="absolute right-0">{money(usage.cap)}</span>
              </div>
            </div>
          )}
          <p className={`mt-2 ${SUBTLE}`}>{t("assist_admin.usage.cap_note")}</p>
        </Section>

        <Section title={t("assist_admin.usage.quality")} id="aa-quality">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {(["unavailable", "rate_limited", "empty"] as const).map((k) => (
              <div key={k}>
                <dt className={MUTED}>{t(`assist_admin.usage.rate_${k}`)}</dt>
                <dd className={`text-md ${MONO}`}>{pct(usage.failure_rates[k])}</dd>
              </div>
            ))}
            {/* 检索降级: the embedding service was down (or had no vectors) and the whole corpus went in.
                A low-similarity fallback is retrieval working as meant, so it is not counted here. */}
            <div>
              <dt className={MUTED}>{t("assist_admin.usage.rate_fallback")}</dt>
              <dd className={`text-md ${MONO}`} data-testid="aa-rate-fallback">
                {pct(usage.requests ? usage.by_retrieval.fallback / usage.requests : 0)}
              </dd>
            </div>
          </dl>
          {/* 改用备用: only questions the backup answered (§13.5), laid out like 检索降级 above. */}
          <dl className="mt-3 text-sm">
            <dt className={MUTED}>{t("assist_admin.usage.fallback")}</dt>
            <dd className={`text-md ${MONO}`} data-testid="aa-fallbacks">
              {t("assist_admin.usage.fallback_value", {
                n: count(usage.fallbacks.count),
                pct: pct(usage.requests ? usage.fallbacks.count / usage.requests : 0),
              })}
            </dd>
            <dd className={SUBTLE} data-testid="aa-fallback-reasons">
              {[...ALWAYS_REASONS, ...RARE_REASONS.filter((r) => usage.fallbacks.by_reason[r] > 0)]
                .map((r) => t(`assist_admin.usage.reason.${r}`, { n: count(usage.fallbacks.by_reason[r]) }))
                .join(" · ")}
            </dd>
          </dl>
          <p className={`mt-2 ${SUBTLE}`}>{t("assist_admin.usage.quality_note", { count: count(usage.requests) })}</p>
          <p className={SUBTLE}>{t("assist_admin.usage.fallback_note")}</p>
        </Section>

        <Section
          title={t("assist_admin.usage.by_day")}
          id="aa-by-day"
          aside={
            <Button type="button" size="sm" variant="ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? t("assist_admin.usage.as_chart") : t("assist_admin.usage.as_table")}
            </Button>
          }
        >
          {asTable ? (
            // The non-visual equivalent of the bars: the cost split into 主 and 备 (frame 7a).
            <Table
              head={[
                t("assist_admin.usage.date"),
                t("assist_admin.usage.requests"),
                t("assist_admin.usage.tokens"),
                t("assist_admin.usage.legend_primary"),
                t("assist_admin.usage.legend_backup"),
              ]}
              rows={usage.by_day.map((d) => [d.date, count(d.requests), count(d.input_tokens + d.output_tokens), money(d.primary_cost), money(d.backup_cost)])}
              monoFirst
            />
          ) : usage.by_day.length ? (
            <DayBars days={usage.by_day} />
          ) : (
            <p className={SUBTLE}>{t("assist_admin.usage.no_days")}</p>
          )}
          {backupCost !== null && (
            // Month totals per role; the bars above split each day the same way.
            <p className={`mt-2 flex flex-wrap gap-x-4 ${SUBTLE}`} data-testid="aa-cost-legend">
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className="inline-block h-2 w-3 bg-[oklch(var(--color-ink-muted))]" />
                {t("assist_admin.usage.legend_primary")} <span className={MONO}>{money(primaryCost)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className={`inline-block h-2 w-3 ${HATCH}`} />
                {t("assist_admin.usage.legend_backup")} <span className={MONO}>{money(backupCost)}</span>
              </span>
            </p>
          )}
        </Section>
      </div>

      <div>
        <Section title={t("assist_admin.usage.by_side")} id="aa-by-side">
          <Table
            head={[t("assist_admin.usage.side"), t("assist_admin.usage.requests"), t("assist_admin.usage.answered"), t("assist_admin.usage.tokens"), t("assist_admin.usage.cost")]}
            rows={usage.by_side.map((s) => [t(`assist_admin.eval.side_${s.side}`), count(s.requests), count(s.answered), count(s.input_tokens + s.output_tokens), money(s.cost)])}
          />
        </Section>

        <Section title={t("assist_admin.usage.by_hall")} id="aa-by-hall">
          <Table
            head={[t("assist_admin.halls.hall"), t("assist_admin.usage.requests"), t("assist_admin.usage.answered"), t("assist_admin.usage.tokens"), t("assist_admin.usage.cost")]}
            rows={usage.by_hall.map((h) => [h.code ?? t("assist_admin.usage.no_hall"), count(h.requests), count(h.answered), count(h.input_tokens + h.output_tokens), money(h.cost)])}
          />
        </Section>

        <Section title={t("assist_admin.usage.phase4")} id="aa-phase4" aside={<span className={SUBTLE}>{t("assist_admin.usage.phase4_note")}</span>}>
          <dl className="grid gap-3 text-sm">
            <Metric
              label={t("assist_admin.usage.corpus_tokens")}
              value={`${count(p4.corpus_tokens)} / ${count(p4.corpus_threshold)}`}
              reached={p4.corpus_reached}
            />
            <Metric
              label={t("assist_admin.usage.empty_share")}
              value={`${pct(p4.empty_share)} / ${pct(p4.empty_threshold)}`}
              reached={p4.empty_reached}
            />
          </dl>
        </Section>
      </div>
    </div>
  );
}

type Day = AssistAdminUsage["by_day"][number];
type T = ReturnType<typeof useI18n>["t"];

/** "2026-09-17" → "9/17". */
const shortDate = (iso: string) => iso.slice(5).split("-").map(Number).join("/");

/** 「9/17 主 x · 备 y · 改用备用 n 次 · 连不上」: the day's most frequent reason, only when there was a switch. */
function dayDetail(t: T, d: Day) {
  const main = REASONS.reduce<(typeof REASONS)[number] | null>(
    (best, r) => (d.fallback_reasons[r] > (best ? d.fallback_reasons[best] : 0) ? r : best),
    null
  );
  const line = `${shortDate(d.date)} ${t("assist_admin.usage.day_detail", { a: money(d.primary_cost), b: money(d.backup_cost), n: count(d.fallbacks) })}`;
  // The reason labels end in their count ({{n}}); the detail names the reason alone.
  return main ? `${line} · ${t(`assist_admin.usage.reason.${main}`, { n: "" }).trim()}` : line;
}

/**
 * Frame 7a's daily cost: primary solid ink2, the backup hatched and stacked on top — no hue, the backup is
 * not a status. Each bar is a button labelled with its whole detail line; the table view is the full
 * non-visual equivalent. Plain CSS rather than the chart library, which cannot draw the hatching.
 */
function DayBars({ days }: { days: Day[] }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const top = Math.max(...days.map((d) => d.cost)) || 1;
  const day = days.find((d) => d.date === picked);
  const h = (cost: number) => ({ height: `${(cost / top) * 100}%` });
  return (
    <div>
      <div role="group" aria-label={t("assist_admin.usage.by_day")} className="flex h-40 items-end gap-px" data-testid="aa-day-bars">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            aria-label={dayDetail(t, d)}
            aria-pressed={d.date === picked}
            onClick={() => setPicked(d.date === picked ? null : d.date)}
            data-testid="aa-day"
            className={`flex h-full min-w-0 flex-1 flex-col-reverse ${d.date === picked ? "bg-[oklch(var(--color-surface-2))]" : ""}`}
          >
            <span data-testid="aa-day-primary" className="w-full bg-[oklch(var(--color-ink-muted))]" style={h(d.primary_cost)} />
            {d.backup_cost > 0 && <span data-testid="aa-day-backup" className={`w-full ${HATCH}`} style={h(d.backup_cost)} />}
          </button>
        ))}
      </div>
      <div aria-hidden="true" className={`mt-1 flex justify-between ${SUBTLE} ${MONO}`}>
        <span>{shortDate(days[0].date)}</span>
        {days.length > 1 && <span>{shortDate(days[days.length - 1].date)}</span>}
      </div>
      <p aria-live="polite" data-testid="aa-day-detail" className={`mt-2 min-h-5 text-sm ${MONO}`}>
        {day && dayDetail(t, day)}
      </p>
    </div>
  );
}

function Metric({ label, value, reached }: { label: string; value: string; reached: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`border-l-2 pl-3 ${reached ? "border-[oklch(var(--color-accent))]" : "border-[oklch(var(--color-hairline))]"}`}>
      <dt className={MUTED}>{label}</dt>
      <dd className={MONO}>{value}</dd>
      <dd className={reached ? "text-[oklch(var(--color-accent-ink))]" : SUBTLE}>
        {reached ? t("assist_admin.usage.reached") : t("assist_admin.usage.not_reached")}
      </dd>
    </div>
  );
}

function Table({ head, rows, monoFirst = false }: { head: string[]; rows: string[][]; monoFirst?: boolean }) {
  const { t } = useI18n();
  if (!rows.length) return <p className={SUBTLE}>{t("assist_admin.usage.empty")}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={`text-left ${SUBTLE}`}>
          {head.map((h, i) => (
            <th key={h} className={`py-1 font-normal ${i ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]} className="border-t border-[oklch(var(--color-hairline))]">
            {r.map((c, i) => (
              <td key={i} className={`py-1 ${i ? `text-right ${MONO}` : monoFirst ? MONO : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
