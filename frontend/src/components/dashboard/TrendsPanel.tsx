"use client";

import { useMemo, useState } from "react";
import { useLedgerTrends } from "@soulledger/core/hooks/useLedgerTrends";
import type { LedgerTrendPoint, LedgerTrendRange } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { orderLifecycle } from "@/src/components/dashboard/LegendLedger";
import { soulStateGlyph } from "@/src/lib/soulStateBadge";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";

const RANGES: { key: LedgerTrendRange; text: string }[] = [
  { key: "30d", text: "dashboard.trends.range_30d" },
  { key: "90d", text: "dashboard.trends.range_90d" },
  { key: "12m", text: "dashboard.trends.range_12m" },
];
type Dimension = "state" | "civilization";
const LIFECYCLE = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"];

/** 两组分段开关(A14 §5):每段 44 高,选中项墨色实底;一组里恰有一个开着,所以是 aria-pressed 不是 role="tab"。 */
function Segments<T extends string>({
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
    <div role="group" aria-label={label} className="flex border border-[oklch(var(--color-line))]">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`inline-flex min-h-(--control-h-sm) items-center justify-center px-4 text-sm transition-colors duration-fast ${
              on
                ? "bg-[oklch(var(--color-ink))] font-semibold text-[oklch(var(--color-canvas))]"
                : "text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
            }`}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

interface Cell {
  key: string;
  glyph: string;
  namespace: string;
  pick: (p: LedgerTrendPoint) => number;
}

type Change = { arrow: "↑" | "↓" | "→"; pct: number | null };

/** 较区间起点(区间里最早的那份快照):起点为 0 而现在不为 0 时没有百分比可说,`pct` 为 null。 */
function changeOf(first: number, last: number): Change {
  if (first === 0) return last === 0 ? { arrow: "→", pct: 0 } : { arrow: "↑", pct: null };
  const pct = Math.round((Math.abs(last - first) / first) * 100);
  if (pct === 0) return { arrow: "→", pct: 0 };
  return { arrow: last > first ? "↑" : "↓", pct };
}

const W = 200;
const H = 56;
const PAD = 3;

/** 一格的线:纵轴只属于这一格(最低到最高铺满),横轴是整个区间 —— 没满的那段留空,不画成零。 */
function Sparkline({ values, xs }: { values: number[]; xs: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) => (max === min ? H / 2 : H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD));
  const pts = values.map((v, i) => `${(xs[i] * W).toFixed(1)},${y(v).toFixed(1)}`);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full flex-1 overflow-visible">
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} className="stroke-[oklch(var(--color-line))]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {values.length === 1 ? (
        <circle cx={xs[0] * W} cy={y(values[0])} r="2.5" className="fill-[oklch(var(--color-chart-1))]" />
      ) : (
        <polyline
          points={pts.join(" ")}
          fill="none"
          className="stroke-[oklch(var(--color-chart-1))]"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/**
 * 仪表盘「趋势」(A14 §5 正式稿):小多图 —— 每个状态或文明一格,纵轴各自独立
 * (「存活」约占六成,同轴会压平其余线)。数据:`ledger.snapshot_census_for_tenant` 每天 00:00 记的
 * 普查快照,从部署那天起有数,不回填。文明色不进图表,线只用 `--color-chart-1`。
 */
export function TrendsPanel() {
  const { t, formatDateTime } = useI18n();
  const [range, setRange] = useState<LedgerTrendRange>("30d");
  const [dimension, setDimension] = useState<Dimension>("state");
  const { data, isLoading, isError, refetch } = useLedgerTrends(range);
  const points: LedgerTrendPoint[] = useMemo(() => data?.points ?? [], [data]);

  const cells: Cell[] = useMemo(() => {
    if (dimension === "state") {
      const present = [...new Set([...points.flatMap((p) => Object.keys(p.by_state)), "LOST"])];
      return orderLifecycle(LIFECYCLE, present).map((key) => ({
        key,
        glyph: soulStateGlyph(key),
        namespace: "souls.states",
        pick: (p) => p.by_state[key] ?? 0,
      }));
    }
    return CIVILIZATION_OPTIONS.map((key) => ({
      key,
      glyph: CIVILIZATION_MARK[key] ?? "?",
      namespace: "tenant.civilizations",
      pick: (p) => p.by_civilization[key] ?? 0,
    }));
  }, [dimension, points]);

  const formatDay = (day: string) => formatDateTime(`${day}T12:00:00Z`, { month: "numeric", day: "numeric", timeZone: "UTC" });
  const since = data?.since ?? points[0]?.day;
  const until = data?.until ?? points[points.length - 1]?.day;
  const spanDays = since && until ? Math.max(1, dayNumber(until) - dayNumber(since)) : 1;
  const xs = points.map((p) => (since ? Math.min(1, Math.max(0, (dayNumber(p.day) - dayNumber(since)) / spanDays)) : 0));
  // 区间没满(部署后头几十天):第一份快照晚于区间起点,左边那段是「还没有记录」,不是零。
  const partial = points.length > 0 && since !== undefined && points[0].day > since;

  const minWidth = dimension === "state" ? "300px" : "240px";
  const grid = { gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))` };

  let body;
  if (isLoading) {
    body = (
      <div data-trends-state="loading" style={grid} className="grid gap-4">
        {Array.from({ length: dimension === "state" ? 6 : 4 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <div data-trends-state="error" role="alert" className="flex flex-wrap items-center gap-3 border border-[oklch(var(--color-danger))] p-4 text-sm text-[oklch(var(--color-ink))]">
        <span>
          <span aria-hidden="true">! </span>
          {t("dashboard.trends.error")}
        </span>
        <Button type="button" variant="secondary" onClick={() => refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (points.length === 0) {
    body = (
      <div data-trends-state="empty" className="flex flex-col gap-2">
        <p className="m-0 text-md text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">○ </span>
          {t("dashboard.trends.empty_title")}
        </p>
        <p className="m-0 text-sm text-[oklch(var(--color-ink-muted))]">{t("dashboard.trends.empty_body")}</p>
        <div aria-hidden="true" className="mt-6 border-b border-dashed border-[oklch(var(--color-line))]" />
      </div>
    );
  } else {
    body = (
      <div data-trends-state="ready" className="flex flex-col gap-4">
        {partial ? (
          <p data-trends-partial="" className="m-0 text-sm text-[oklch(var(--color-ink-muted))]">
            <span aria-hidden="true">◐ </span>
            {t("dashboard.trends.partial", { n: String(points.length) })}
          </p>
        ) : null}
        <div style={grid} className="grid gap-4">
          {cells.map((cell) => {
            const values = points.map(cell.pick);
            const current = values[values.length - 1];
            const change = changeOf(values[0], current);
            const resolved = resolveEnumDisplay(t, cell.namespace, cell.key);
            const name = resolved.state === "known" ? resolved.label : t("common.value.unrecorded");
            const changeAria =
              change.pct === null
                ? t("dashboard.trends.change_from_zero")
                : change.arrow === "→"
                  ? t("dashboard.trends.change_flat")
                  : t(change.arrow === "↑" ? "dashboard.trends.change_up" : "dashboard.trends.change_down", { pct: String(change.pct) });
            const changeText = change.pct === null ? `${change.arrow} ${t("dashboard.trends.change_from_zero")}` : `${change.arrow} ${change.pct}%`;
            return (
              <figure
                key={cell.key}
                data-trend-cell={cell.key}
                aria-label={t("dashboard.trends.figure_label", { name, value: String(current), change: changeAria })}
                className="m-0 flex min-w-0 flex-col gap-2 border-t border-[oklch(var(--color-ink))] pt-2"
              >
                {/* 名字过长:数值与变化另起一行放在格名下(flex-wrap);一行都放不下时截断加「…」。 */}
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 max-w-full items-baseline gap-2 text-sm text-[oklch(var(--color-ink))]">
                    <span aria-hidden="true" className="shrink-0 font-mono text-[oklch(var(--color-ink-subtle))]">{cell.glyph}</span>
                    <DomainEnum namespace={cell.namespace} value={cell.key} className="block truncate" />
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span data-trend-latest="" className="font-mono text-xl tabular-nums text-[oklch(var(--color-ink))]">{current}</span>
                    <span data-trend-change="" className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{changeText}</span>
                  </span>
                </div>
                <div className="flex items-stretch gap-2">
                  <div aria-hidden="true" className="flex flex-col justify-between font-mono text-2xs tabular-nums text-[oklch(var(--color-ink-subtle))]">
                    <span data-trend-max="">{Math.max(...values)}</span>
                    <span data-trend-min="">{Math.min(...values)}</span>
                  </div>
                  <Sparkline values={values} xs={xs} />
                </div>
                <div aria-hidden="true" className="flex justify-between font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                  <span>{since ? formatDay(since) : ""}</span>
                  <span>{until ? formatDay(until) : ""}</span>
                </div>
              </figure>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section
      data-trends-panel=""
      aria-busy={isLoading}
      className="flex min-w-0 flex-col gap-4 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-[family-name:var(--font-title)] text-lg text-[oklch(var(--color-ink))]">{t("dashboard.trends.title")}</h2>
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("dashboard.trends.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Segments
            label={t("dashboard.trends.range_label")}
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ key: r.key, text: t(r.text) }))}
          />
          <Segments
            label={t("dashboard.trends.dimension_label")}
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
