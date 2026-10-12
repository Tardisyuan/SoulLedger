/**
 * A list page's filters, remembered in this browser (2026-10-13): an officer who looks at the same slice of
 * the ledger every day should not rebuild it after every reload. Strings only, one flat object per page.
 *
 * Read on mount, and only when the address did not ask for a filter of its own (`?state=`, `?q=` ... win).
 * localStorage can be missing or throw (private window, blocked site data): both functions then do nothing.
 * ponytail: per browser, not per account -- move it into `User.preferences` if two officers sharing one
 * browser ever need separate memories.
 */
export function readFilters<K extends string>(key: string, fields: readonly K[]): Partial<Record<K, string>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    const out: Partial<Record<K, string>> = {};
    for (const f of fields) {
      const v = (raw as Record<string, unknown>)[f];
      if (typeof v === "string" && v !== "") out[f] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeFilters(key: string, values: Record<string, string>): void {
  try {
    const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
    if (Object.keys(kept).length) localStorage.setItem(key, JSON.stringify(kept));
    else localStorage.removeItem(key);
  } catch {
    /* remembered filters are a convenience */
  }
}
