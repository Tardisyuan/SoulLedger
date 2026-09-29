"use client";

import { useState } from "react";
import type { AssistAdminUsage } from "@soulledger/core/api/assist-admin";
import { useAssistUsage } from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { useChartColors } from "@/src/hooks/useChartColors";
import { LazyBarChart } from "@/src/components/charts/LazyDashboardCharts";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { QueryError } from "@/src/components/ui/PageError";
import { ListSkeleton } from "@/components/ui/skeleton";
import { AssistAdminTabs, MONO, MUTED, SUBTLE, Section, count, money, pct } from "./parts";

/** `ALERT_SHARE` in backend/apps/soul_assist/usage.py. */
const ALERT_SHARE = 0.8;

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
  const { CHART_SERIES } = useChartColors();
  const [asTable, setAsTable] = useState(false);
  const share = usage.cap ? usage.spent / usage.cap : null;
  const days = usage.by_day.map((d) => ({ ...d, name: d.date.slice(5) }));
  const p4 = usage.phase4;

  return (
    <div className="grid gap-x-10 lg:grid-cols-2">
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
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(["unavailable", "rate_limited", "empty"] as const).map((k) => (
              <div key={k}>
                <dt className={MUTED}>{t(`assist_admin.usage.rate_${k}`)}</dt>
                <dd className={`text-md ${MONO}`}>{pct(usage.failure_rates[k])}</dd>
              </div>
            ))}
          </dl>
          <p className={`mt-2 ${SUBTLE}`}>{t("assist_admin.usage.quality_note", { count: count(usage.requests) })}</p>
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
            <Table
              head={[t("assist_admin.usage.date"), t("assist_admin.usage.requests"), t("assist_admin.usage.tokens"), t("assist_admin.usage.cost")]}
              rows={usage.by_day.map((d) => [d.date, count(d.requests), count(d.input_tokens + d.output_tokens), money(d.cost)])}
              monoFirst
            />
          ) : days.length ? (
            <LazyBarChart data={days} dataKey="cost" fill={CHART_SERIES.realm} height={180} name={t("assist_admin.usage.cost")} />
          ) : (
            <p className={SUBTLE}>{t("assist_admin.usage.no_days")}</p>
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
