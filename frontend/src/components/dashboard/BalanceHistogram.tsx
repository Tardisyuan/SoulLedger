/**
 * 余额分布(Design A4):200 高的直方图,柱间 3px,底边 1px ink。**0 以下的柱用梯度第 4 档、
 * 0 以上用第 2 档** —— 两档明度分开,负值不用红(余额为负不是一次出错,反馈色不进领域数据)。
 * 一条 1px ink 的 0 线竖在两边之间;跨 0 的那一档(「-5 to 5」)左半第 4 档、右半第 2 档,
 * 0 线正好穿过它的中间。
 *
 * 每根柱的数写在柱顶上方,档名写在底下(等宽),所以正负从不只靠明度。
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

export function BalanceHistogram({ bars }: { bars: HistogramBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const columns = { gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` };
  const zeroAt = zeroLineAt(bars);
  return (
    <div data-histogram="">
      <div className="relative grid h-50 items-end gap-[3px] border-b border-[oklch(var(--color-ink))]" style={columns}>
        {bars.map((b) => (
          <div key={b.label} data-histogram-bar={b.label} className="flex h-full flex-col items-center justify-end gap-0.5">
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
      <div className="grid gap-[3px] pt-1 text-center font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" style={columns}>
        {bars.map((b) => (
          <span key={b.label}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
