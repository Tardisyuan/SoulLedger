/**
 * 业力分布 · 余额(规范 v1 §3.4): a plain histogram. The count sits above each
 * bar, never on it; the bucket label below in mono. Negative buckets are
 * danger, the zero bucket neutral, positive ones success — and the label says
 * which is which, so the sign never rests on colour alone.
 */
export interface HistogramBar {
  label: string;
  count: number;
  tone: "negative" | "zero" | "positive";
}

const TONE: Record<HistogramBar["tone"], string> = {
  negative: "bg-[oklch(var(--color-danger))]",
  zero: "bg-[oklch(var(--color-ink-subtle))]",
  positive: "bg-[oklch(var(--color-success))]",
};

/** Tallest bar, in px. */
const MAX_BAR = 100;

export function BalanceHistogram({ bars }: { bars: HistogramBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div data-histogram="">
      <div
        className="grid h-36 items-end gap-1.5 border-b border-[oklch(var(--color-block))] pt-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` }}
      >
        {bars.map((b) => (
          <div key={b.label} data-histogram-bar={b.label} className="flex h-full flex-col items-center justify-end gap-0.5">
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{b.count}</span>
            <span aria-hidden="true" className={`block w-full ${TONE[b.tone]}`} style={{ height: `${(b.count / max) * MAX_BAR}px` }} />
          </div>
        ))}
      </div>
      <div
        className="grid gap-1.5 pt-1 text-center font-mono text-2xs text-[oklch(var(--color-ink-subtle))]"
        style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 1)}, minmax(0, 1fr))` }}
      >
        {bars.map((b) => (
          <span key={b.label}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
