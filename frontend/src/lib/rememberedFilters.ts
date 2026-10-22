import { useEffect, useRef } from "react";

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

/**
 * `/souls` 的记忆套路(进页读一次、读完才写、地址带了筛选就不读)做成 hook,给其余列表页共用。
 * `values` 只放「常驻」的值(下拉、开关、排序);搜索框的字和从别处带来的 id 不放,它们属于一次到访。
 * `skip`:地址已经自己要了筛选时为 true,不读取。写在读之前声明,所以首次渲染的默认值不会盖掉已存的。
 */
export function useRememberedFilters<K extends string>(
  key: string,
  fields: readonly K[],
  values: Record<K, string>,
  restore: (saved: Partial<Record<K, string>>) => void,
  skip = false
): void {
  // The values as first rendered, until they first change; then "" (no JSON string equals it). Writing the
  // first-render values would store the defaults over what was saved: under React StrictMode (dev) effects
  // run twice before the restore's setState lands, and a default such as the events page's 「近 7 天」 then
  // replaced a stored 「近 30 天」 (seen 2026-10-23). A "ready" flag let that second write through.
  const pristine = useRef<string | null>(null);
  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (pristine.current === null || serialized === pristine.current) return;
    pristine.current = "";
    writeFilters(key, JSON.parse(serialized) as Record<string, string>);
  }, [key, serialized]);
  useEffect(() => {
    if (!skip) restore(readFilters(key, fields));
    if (pristine.current === null) pristine.current = serialized;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载(或地址是否带筛选改变)时读一次
  }, [key, skip]);
}
