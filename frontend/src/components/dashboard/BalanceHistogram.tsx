/**
 * 业力分布 · 余额(规范 v1 §3.4): a plain histogram. The count sits above each
 * bar, never on it; the bucket label below in mono — so the sign never rests on
 * the fill alone.
 *
 * 规范 v2 补足 A5「功 / 过 · 实底与空框斜线 · 零线 2px ink」:正余额(功)梯度第 1 档实底,
 * 负余额(过)同色空框加 45° 斜线(`KARMA_PATTERNS` / `HATCH`),零那一档空框。不用
 * 成功 / 失败色 —— 反馈色不进领域数据,余额为负不是一次出错。
 */
export interface HistogramBar {
  label: string;
  count: number;
  tone: "negative" | "zero" | "positive";
}

// 斜线几何与 lib/chart-colors.ts 的 HATCH 同值(45°、1.5、5);Tailwind 要字面类名,所以写死在这里,
// BalanceHistogram.test 对账。
export const TONE: Record<HistogramBar["tone"], string> = {
  positive: "bg-[oklch(var(--color-chart-1))]",
  negative:
    "border border-[oklch(var(--color-chart-1))] bg-[repeating-linear-gradient(45deg,oklch(var(--color-chart-1))_0_1.5px,transparent_1.5px_5px)]",
  zero: "border border-[oklch(var(--color-chart-1))]",
};

/** Tallest bar, in px. */
const MAX_BAR = 100;

export function BalanceHistogram({ bars }: { bars: HistogramBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div data-histogram="">
      <div
        className="grid h-36 items-end gap-2 border-b-2 border-[oklch(var(--color-ink))] pt-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` }}
      >
        {bars.map((b) => (
          <div key={b.label} data-histogram-bar={b.label} className="flex h-full flex-col items-center justify-end gap-0.5">
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{b.count}</span>
            <span aria-hidden="true" data-tone={b.tone} className={`block w-full ${TONE[b.tone]}`} style={{ height: `${(b.count / max) * MAX_BAR}px` }} />
          </div>
        ))}
      </div>
      <div
        className="grid gap-2 pt-1 text-center font-mono text-2xs text-[oklch(var(--color-ink-subtle))]"
        style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` }}
      >
        {bars.map((b) => (
          <span key={b.label}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
