import type { ReactNode } from "react";

/**
 * 图例账(规范 v1 §3.4): no pie, no text on colour. A proportion bar that only
 * gestures at the shares, and every number in ledger rows beneath it — so a
 * 3 % slice never has a label squeezed onto it or dropped.
 */
export interface LegendLedgerRow {
  key: string;
  label: ReactNode;
  count: number;
  /** A background utility for the bar segment and the row's key swatch. */
  swatchClass: string;
}

export function sharePercent(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

export function LegendLedger({ rows }: { rows: LegendLedgerRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <div data-legend-ledger="">
      {/* Decorative: every value it shows is in the rows below. */}
      <div aria-hidden="true" className="mt-3 flex h-3.5 gap-px">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <span key={r.key} className={`min-w-1 ${r.swatchClass}`} style={{ flexGrow: r.count }} />
          ))}
      </div>
      <div className="mt-2">
        {rows.map((r) => (
          <div
            key={r.key}
            data-legend-row={r.key}
            className="grid min-h-7 grid-cols-[18px_1fr_40px_50px] items-center border-b border-[oklch(var(--color-rule))] text-sm"
          >
            <span aria-hidden="true" className={`block size-2.5 ${r.swatchClass}`} />
            <span className="text-[oklch(var(--color-ink))]">{r.label}</span>
            <span className="text-right font-mono text-[oklch(var(--color-ink))]">{r.count}</span>
            <span className="text-right font-mono text-[oklch(var(--color-ink-subtle))]">{sharePercent(r.count, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
