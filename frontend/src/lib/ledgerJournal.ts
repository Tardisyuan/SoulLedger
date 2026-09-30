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

/**
 * 逐行结余(补足 B10「结余」列):行按时间倒序到来,最新一行之后的余额就是期末,
 * 往下每一行再减去上一行的发生额(功 +、过 −)。只在拿到**整月**的行时成立 —— 页面
 * 因此不分页。
 */
export function runningBalances(rows: LedgerJournalRow[], closing: number): number[] {
  const out: number[] = [];
  let balance = closing;
  for (const r of rows) {
    out.push(balance);
    balance -= r.record_type === "MERIT" ? r.weight : -r.weight;
  }
  return out;
}

