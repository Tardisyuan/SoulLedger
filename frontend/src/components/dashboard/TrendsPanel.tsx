"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useLedgerTrends } from "@soulledger/core/hooks/useLedgerTrends";
import type { LedgerTrendPoint, LedgerTrendRange } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { useChartColors } from "@/src/hooks/useChartColors";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { orderLifecycle } from "@/src/components/dashboard/LegendLedger";
import { soulStateGlyph } from "@/src/lib/soulStateBadge";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import type { TrendsChartProps } from "@/src/components/dashboard/TrendsChart";

// recharts 不进仪表盘首屏的包:图在面板自己的块里按需加载。
const TrendsChart = dynamic<TrendsChartProps>(() => import("@/src/components/dashboard/TrendsChart"), {
  ssr: false,
  loading: () => <Skeleton className="h-60 w-full" />,
});

const RANGES: { key: LedgerTrendRange; text: string }[] = [
  { key: "30d", text: "dashboard.trends.range_30d" },
  { key: "90d", text: "dashboard.trends.range_90d" },
  { key: "12m", text: "dashboard.trends.range_12m" },
];
type Dimension = "state" | "civilization";
const LIFECYCLE = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"];
/** 线型:梯度相邻两档明度很近,所以线型是第二道区分,图例里的字形是第三道。 */
const DASHES = [undefined, "6 3", "2 3", "8 3 2 3", "1 4", "10 4"];

function SwitchGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; text: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          // 与仪表盘的标签页同一个约定:一组开关,恰有一个开着,所以是 aria-pressed 不是 role="tab"。
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`${TAB_BASE} ${value === o.key ? TAB_ON : TAB_OFF}`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/**
 * 仪表盘「趋势」(数据:`ledger.snapshot_census_for_tenant` 每天夜里记的普查快照,从部署那天起有数,不回填)。
 *
 * 暂无 Design 稿 —— 沿用 A4 的图表约定:冷灰蓝明度梯度(`useChartColors`)、文明色不进图、
 * 区分靠线型 + 墨色字形图例,不靠色相。图例每行一个字形、名字和最新一天的数。
 */
export function TrendsPanel() {
  const { t, formatDateTime } = useI18n();
  const colors = useChartColors();
  const [range, setRange] = useState<LedgerTrendRange>("30d");
  const [dimension, setDimension] = useState<Dimension>("state");
  const { data, isLoading, isError, refetch } = useLedgerTrends(range);
  const points: LedgerTrendPoint[] = useMemo(() => data?.points ?? [], [data]);

  const series = useMemo(() => {
    const enumLabel = (ns: string, key: string) => {
      const r = resolveEnumDisplay(t, ns, key);
      return r.state === "known" ? r.label : t("common.value.unrecorded");
    };
    if (dimension === "state") {
      const present = [...new Set(points.flatMap((p) => Object.keys(p.by_state)))];
      return orderLifecycle(LIFECYCLE, present).map((key, i) => ({
        key,
        glyph: soulStateGlyph(key),
        label: enumLabel("souls.states", key),
        stroke: colors.STATE_COLORS[key] ?? colors.STATE_COLORS.ALIVE,
        dash: DASHES[i % DASHES.length],
        pick: (p: LedgerTrendPoint) => p.by_state[key] ?? 0,
      }));
    }
    const ramp = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING"].map((s) => colors.STATE_COLORS[s]);
    return CIVILIZATION_OPTIONS.map((key, i) => ({
      key,
      glyph: CIVILIZATION_MARK[key] ?? "?",
      label: enumLabel("souls.civilizations", key),
      stroke: ramp[i % ramp.length],
      dash: DASHES[i % DASHES.length],
      pick: (p: LedgerTrendPoint) => p.by_civilization[key] ?? 0,
    }));
  }, [dimension, points, colors, t]);

  const rows = useMemo(
    () => points.map((p) => Object.fromEntries([["day", p.day], ...series.map((s) => [s.key, s.pick(p)])])),
    [points, series],
  );
  const last = points[points.length - 1];
  const formatDay = (day: string) =>
    formatDateTime(`${day}T12:00:00Z`, { month: "numeric", day: "numeric", timeZone: "UTC" });

  let body;
  if (isLoading) {
    body = (
      <div data-trends-state="loading">
        <Skeleton className="h-60 w-full" />
      </div>
    );
  } else if (isError) {
    body = (
      <div data-trends-state="error" role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[oklch(var(--color-danger))]">
        <span>
          <span aria-hidden="true">✕ </span>
          {t("dashboard.trends.error")}
        </span>
        <Button type="button" variant="secondary" onClick={() => refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (points.length < 2) {
    // 0 或 1 个点画不出线 —— 说原因,不画一条贴着轴的假线。
    body = (
      <div data-trends-state="empty">
        <EmptyState title={t("dashboard.trends.not_enough")} />
      </div>
    );
  } else {
    body = (
      <div data-trends-state="ready" className="space-y-3">
        <TrendsChart
          rows={rows}
          series={series.map(({ key, label, stroke, dash }) => ({ key, label, stroke, dash }))}
          formatDay={formatDay}
        />
        <ul className="border-t border-[oklch(var(--color-line))]">
          {series.map((s) => (
            <li
              key={s.key}
              data-trend-series={s.key}
              className="grid min-h-8 grid-cols-[28px_20px_1fr_auto] items-center gap-x-2 border-b border-[oklch(var(--color-line))] text-sm"
            >
              <svg aria-hidden="true" width="28" height="8" className="shrink-0">
                <line x1="0" y1="4" x2="28" y2="4" stroke={s.stroke} strokeWidth="2" strokeDasharray={s.dash} />
              </svg>
              <span aria-hidden="true" className="font-mono text-[oklch(var(--color-ink-subtle))]">{s.glyph}</span>
              <span className="text-[oklch(var(--color-ink))]">{s.label}</span>
              <span data-trend-latest="" className="text-right font-mono tabular-nums">{last ? s.pick(last) : 0}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section
      data-trends-panel=""
      aria-busy={isLoading}
      className="flex min-w-0 flex-col gap-3 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg text-[oklch(var(--color-ink))]">{t("dashboard.trends.title")}</h2>
        <div className="flex flex-wrap gap-x-4">
          <SwitchGroup
            label={t("dashboard.trends.range_label")}
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ key: r.key, text: t(r.text) }))}
          />
          <SwitchGroup
            label={t("dashboard.trends.title")}
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "state", text: t("dashboard.trends.by_state") },
              { key: "civilization", text: t("dashboard.trends.by_civilization") },
            ]}
          />
        </div>
      </div>
      {body}
    </section>
  );
}
