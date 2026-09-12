/**
 * The shipped zh-Hans bundle, for tests that need to assert the words an
 * operator reads rather than the key a mock echoed back.
 *
 * `LedgerPage.test.tsx` grew the first copy of `zh()` after DF-01: two tests
 * asserted `findByText("ledger.no_state_distribution")` — the raw key —
 * because `mockT` echoes keys, and that pinned the defect (the key was in no
 * bundle, so the screen really did show it). The 2026-09-12 audit found the
 * same shape four more times, with enum members instead of keys: a key-echo
 * `t` makes `<DomainEnum>` render "unrecognized" for *every* member, so the
 * tests pinned `CREATE` / `ADMIN` / `JUDGE` as correct output (FT-01).
 *
 * `tZh` is the real `t` on the zh-Hans bundle: lookup, key on a miss,
 * `{{param}}` / `{param}` interpolation — `I18nContext.tsx`'s own three rules.
 * Install it with `mockT.mockImplementation(tZh)` inside the test that needs
 * real copy; the suites keep key-echo as their default because most of their
 * assertions are about *which* key was chosen, not the sentence behind it.
 */
import zhHans from "@soulledger/core/messages/zh-Hans.json";

function lookup(key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), zhHans);
  return typeof value === "string" ? value : undefined;
}

/** The zh-Hans sentence behind a key — and a throw, not a fallback, when the bundle has no such key. */
export function zh(key: string, params?: Record<string, string>): string {
  const value = lookup(key);
  if (value === undefined) throw new Error(`zh-Hans bundle has no "${key}" — the page would render the raw key`);
  return interpolate(value, params);
}

/** `t` as the app has it for zh-Hans: real copy, the key itself on a miss. */
export function tZh(key: string, params?: Record<string, string>): string {
  return interpolate(lookup(key) ?? key, params);
}

function interpolate(value: string, params?: Record<string, string>): string {
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (whole, p1, p2) => {
    const k = p1 ?? p2;
    return k in params ? params[k] : whole;
  });
}
