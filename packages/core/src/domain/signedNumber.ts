/**
 * Signed numbers as the ledger writes them (moved from `frontend/src/lib/domainDisplay.ts`, quality audit
 * 2026-11-26 §2.1: about twelve local copies, four of them printing `+0` or an ASCII hyphen).
 *
 * `+0` is a lie: zero has no sign, and printing one implies a positive balance the ledger does not have. A
 * sign is only ever attached to a value that has one, and a negative takes U+2212 `−`, not a hyphen. A value
 * that rounds to zero at the chosen precision is zero (`-0.04` with one digit is `0.0`, not `−0.0`).
 */
export function signedNumber(n: number, opts: { grouping?: boolean; fractionDigits?: number } = {}): string {
  const abs = Math.abs(n);
  const body =
    opts.fractionDigits !== undefined
      ? abs.toFixed(opts.fractionDigits)
      : opts.grouping
        ? abs.toLocaleString("en")
        : String(abs);
  if (!(n > 0 || n < 0) || Number(body.replace(/,/g, "")) === 0) {
    return opts.fractionDigits !== undefined ? (0).toFixed(opts.fractionDigits) : "0";
  }
  return `${n > 0 ? "+" : "−"}${body}`;
}

/** Ink for a signed number. Zero is neutral — it is neither good news nor bad. */
export function signedTone(n: number): "success" | "error" | "neutral" {
  if (n > 0) return "success";
  if (n < 0) return "error";
  return "neutral";
}
