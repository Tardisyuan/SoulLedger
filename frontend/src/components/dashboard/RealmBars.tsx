"use client";

import { DomainEnum } from "@/src/components/ui/DomainValue";
import { REALM_PATTERNS, type ChartPattern } from "@/lib/chart-colors";

/**
 * 按界域(Design A4):240 高的柱图,柱间 20,底边 1px line-strong;柱顶上方等宽 11px 的数,
 * 底下 12px ink-muted 的界域名。柱按界的类型取四种图案之一(`REALM_PATTERNS`,彼此无先后):
 *
 *   炼狱 solid   实底
 *   天界 half    1px 边 + 点阵(半色调)
 *   地狱 hatch   1px 边 + 45° 斜线
 *   中立 outline 只有 1px 边
 *
 * 全部用梯度第 1 档 —— 去向没有先后,图案就是区分,不另加颜色。纯 CSS,不再拉 recharts:
 * 这张图要的「数在柱上、名在柱下」是四个 div 就能画的东西。
 */
export const PATTERN_CLASS: Record<ChartPattern, string> = {
  solid: "bg-[oklch(var(--color-chart-1))]",
  half: "border border-[oklch(var(--color-chart-1))] bg-[radial-gradient(oklch(var(--color-chart-1))_1px,transparent_1px)] bg-size-[4px_4px]",
  hatch:
    "border border-[oklch(var(--color-chart-1))] bg-[repeating-linear-gradient(45deg,oklch(var(--color-chart-1))_0_1.5px,transparent_1.5px_6px)]",
  outline: "border border-[oklch(var(--color-chart-1))]",
};

export interface RealmBar {
  key: string;
  name: string;
  count: number;
  realmType: string;
}

const LEGEND_ORDER = ["PURGATORY", "BLISS", "HELL", "NEUTRAL"] as const;

export function patternOf(realmType: string): ChartPattern {
  return REALM_PATTERNS[realmType] ?? "solid";
}

/** 标题行右侧的图例:四个 12 × 12 样块 + 界名。 */
export function RealmLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[oklch(var(--color-ink-muted))]">
      {LEGEND_ORDER.map((type) => (
        <li key={type} className="flex items-center gap-1">
          <span aria-hidden="true" className={`block size-3 ${PATTERN_CLASS[patternOf(type)]}`} />
          <DomainEnum namespace="realms.types" value={type} />
        </li>
      ))}
    </ul>
  );
}

/** Tallest bar in px — the plot is 240 tall and the count above the bar needs 16 of it. */
const MAX_BAR = 216;

export function RealmBars({ bars }: { bars: RealmBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const columns = { gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` };
  return (
    <div data-realm-bars="" className="overflow-x-auto">
      <div className="min-w-max md:min-w-0">
        <div className="grid h-60 items-end gap-4 border-b border-[oklch(var(--color-line-strong))]" style={columns}>
          {bars.map((b) => (
            <div key={b.key} data-realm-bar={b.key} className="flex h-full min-w-8 flex-col items-center justify-end gap-0.5">
              <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{b.count}</span>
              {b.count > 0 && (
                <span
                  aria-hidden="true"
                  data-pattern={patternOf(b.realmType)}
                  className={`block w-full ${PATTERN_CLASS[patternOf(b.realmType)]}`}
                  style={{ height: `${(b.count / max) * MAX_BAR}px` }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-4 pt-1 text-center text-xs text-[oklch(var(--color-ink-muted))]" style={columns}>
          {bars.map((b) => (
            <span key={b.key} className="min-w-8 truncate" title={b.name}>
              {b.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
