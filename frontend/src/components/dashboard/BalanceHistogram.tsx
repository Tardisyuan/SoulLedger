/**
 * 余额分布(Design A4):200 高的直方图,柱间 3px,底边 1px ink。**0 以下的柱用梯度第 4 档、
 * 0 以上用第 2 档** —— 两档明度分开,负值不用红(余额为负不是一次出错,反馈色不进领域数据)。
 * 一条 1px ink 的 0 线竖在两边之间;跨 0 的那一档(「-5 to 5」)左半第 4 档、右半第 2 档,
 * 0 线正好穿过它的中间。
 *
 * 每根柱的数写在柱顶上方,档名写在底下(等宽),所以正负从不只靠明度。
 * 给了 `ticks`(等宽格,Design A4 的「−300 / −150 / 0 / +150 / +300」)就只写刻度,
 * 档名留在每根柱的 `title` 上 —— 十四格各写一个档名在 393 宽下挤不下。
 */
export interface HistogramBar {
  label: string;
  count: number;
  tone: "negative" | "zero" | "positive";
}

// Tailwind 要字面类名;BalanceHistogram 的测试对账。
export const TONE: Record<HistogramBar["tone"], string> = {
  positive: "bg-[oklch(var(--color-chart-2))]",
  negative: "bg-[oklch(var(--color-chart-4))]",
  zero: "bg-[linear-gradient(to_right,oklch(var(--color-chart-4))_50%,oklch(var(--color-chart-2))_50%)]",
};

/** Tallest bar, in px — the plot is 200 tall and the count above the bar needs 16 of it. */
const MAX_BAR = 176;

/** Where the 0 line sits, as a fraction of the plot's width. */
export function zeroLineAt(bars: HistogramBar[]): number | null {
  const n = bars.length;
  const zero = bars.findIndex((b) => b.tone === "zero");
  if (zero >= 0) return (zero + 0.5) / n;
  const firstPositive = bars.findIndex((b) => b.tone === "positive");
  const hasNegative = bars.some((b) => b.tone === "negative");
  if (firstPositive > 0 && hasNegative) return firstPositive / n;
  return null;
}

/** 刻度:`at` 是在绘图宽度上的位置(0–1)。 */
export interface HistogramTick {
  label: string;
  at: number;
}

export function BalanceHistogram({ bars, ticks }: { bars: HistogramBar[]; ticks?: HistogramTick[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const columns = { gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` };
  const zeroAt = zeroLineAt(bars);
  return (
    <div data-histogram="">
      <div className="relative grid h-50 items-end gap-[3px] border-b border-[oklch(var(--color-ink))]" style={columns}>
        {bars.map((b) => (
          <div key={b.label} data-histogram-bar={b.label} title={ticks ? b.label : undefined} className="flex h-full flex-col items-center justify-end gap-0.5">
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{b.count}</span>
            <span aria-hidden="true" data-tone={b.tone} className={`block w-full ${TONE[b.tone]}`} style={{ height: `${(b.count / max) * MAX_BAR}px` }} />
          </div>
        ))}
        {zeroAt !== null && (
          <span
            aria-hidden="true"
            data-zero-line=""
            className="pointer-events-none absolute inset-y-0 w-px bg-[oklch(var(--color-ink))]"
            style={{ left: `${zeroAt * 100}%` }}
          />
        )}
      </div>
      {ticks ? (
        <div aria-hidden="true" className="relative h-5 pt-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          {ticks.map((tick) => (
            <span
              key={tick.label}
              data-histogram-tick={tick.label}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${tick.at * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="grid gap-[3px] pt-1 text-center font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" style={columns}>
          {bars.map((b) => (
            <span key={b.label}>{b.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Design A4 的刻度值;只画落在某一格下沿上的那几个。 */
const TICK_VALUES = [-300, -150, 0, 150, 300];

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

/**
 * `balance_histogram.buckets`(半开区间 [min, max),两端开口)→ 柱与刻度。
 * 上沿 ≤ 0 的格是负的一边,其余是正的一边;0 线落在 [−50, 0) 与 [0, 50) 之间。
 */
export function histogramFromBuckets(buckets: { min: number | null; max: number | null; count: number }[]): {
  bars: HistogramBar[];
  ticks: HistogramTick[];
} {
  const bars = buckets.map(
    (b): HistogramBar => ({
      label:
        b.min == null ? `< ${signed(b.max ?? 0)}` : b.max == null ? `≥ ${signed(b.min)}` : `${signed(b.min)} – ${signed(b.max)}`,
      count: b.count,
      tone: b.max != null && b.max <= 0 ? "negative" : "positive",
    })
  );
  const ticks = TICK_VALUES.flatMap((v) => {
    const i = buckets.findIndex((b) => b.min === v);
    return i < 0 ? [] : [{ label: signed(v), at: i / buckets.length }];
  });
  return { bars, ticks };
}
