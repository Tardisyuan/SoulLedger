import type { LedgerJournalRow } from "@soulledger/core/api";

/** Pure helpers of the 功过总账 page (app/ledger/page.tsx). */

/** `YYYY-MM` of the current month in UTC — the backend cuts months in UTC. */
export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return currentMonth(d);
}

const fmt = (n: number) => Math.abs(n).toLocaleString("en");
/** A signed figure: `+1,284`, `−937` (U+2212), a bare `0`. */
export function signed(n: number): string {
  return n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(n)}` : "0";
}

/** Rows grouped by the server's UTC `day`, newest day first — the order they arrive in. */
export function groupByDay(rows: LedgerJournalRow[]): { day: string; rows: LedgerJournalRow[] }[] {
  const out: { day: string; rows: LedgerJournalRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.day === row.day) last.rows.push(row);
    else out.push({ day: row.day, rows: [row] });
  }
  return out;
}

