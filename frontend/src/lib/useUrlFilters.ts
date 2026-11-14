import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SEARCH_DEBOUNCE_MS } from "@soulledger/core/hooks/useDebouncedValue";

import { readFilters, writeFilters } from "./rememberedFilters";

/**
 * A list page's filters and page number live in the address (2026-11-15, user decision; audit D3): a link
 * or a reload reopens the same slice and the same page. The address is the source of truth; what
 * `rememberedFilters` stored in this browser is used only when the address names none of the page's
 * filters (and no page).
 *
 * A rule per field validates what the address says, because anyone can type it: a list of the allowed
 * values (an enum: an unknown member is dropped), a RegExp, or `"text"` (free text, trimmed, at most 200
 * characters). `page` must be a positive integer; anything else reads as 1.
 *
 * Writes replace the current history entry -- never push one -- and wait `SEARCH_DEBOUNCE_MS` after the
 * last change, so typing in a search box neither stacks history nor rewrites the address per keystroke.
 * Empty values and page 1 are removed from the address, so clearing the filters cleans the query.
 * Parameters the hook does not own (`?soul=`, `?username=` ...) are kept as they are.
 *
 * `history.replaceState`, not `router.replace`: Next's App Router syncs `useSearchParams` with native
 * history calls, and this way the hook needs no router (several page tests render without one) and the
 * page is not re-fetched.
 */
export type UrlFieldRule = readonly string[] | RegExp | "text";

const MAX_TEXT = 200;

function accept(rule: UrlFieldRule, raw: string | null): string {
  const v = raw?.trim() ?? "";
  if (!v || v.length > MAX_TEXT) return "";
  if (rule === "text") return v;
  if (rule instanceof RegExp) return rule.test(v) ? v : "";
  return rule.includes(v) ? v : "";
}

export function parseUrlFilters<K extends string>(
  query: string,
  fields: Record<K, UrlFieldRule>
): { values: Record<K, string>; page: number; named: boolean } {
  const params = new URLSearchParams(query);
  const values = {} as Record<K, string>;
  let named = false;
  for (const key of Object.keys(fields) as K[]) {
    values[key] = accept(fields[key], params.get(key));
    if (values[key]) named = true;
  }
  const rawPage = params.get("page")?.trim() ?? "";
  const page = /^\d{1,6}$/.test(rawPage) ? Math.max(1, parseInt(rawPage, 10)) : 1;
  return { values, page, named: named || page > 1 };
}

export function buildUrlQuery<K extends string>(
  current: string,
  fields: Record<K, UrlFieldRule>,
  values: Record<K, string>,
  page: number
): string {
  const params = new URLSearchParams(current);
  for (const key of Object.keys(fields) as K[]) {
    const v = values[key]?.trim() ?? "";
    if (v) params.set(key, v);
    else params.delete(key);
  }
  if (page > 1) params.set("page", String(page));
  else params.delete("page");
  return params.toString();
}

/**
 * What the address says on the first render, for the page's `useState` initial values: a page opened from
 * a link then asks for that slice in its very first request instead of the unfiltered list first.
 */
export function useInitialUrlFilters<K extends string>(fields: Record<K, UrlFieldRule>): { values: Record<K, string>; page: number } {
  const query = useSearchParams()?.toString() ?? "";
  return useState(() => parseUrlFilters(query, fields))[0];
}

export function useUrlFilters<K extends string>({
  storageKey,
  fields,
  remember,
  values,
  page,
  restore,
}: {
  /** The `rememberedFilters` key of this page. */
  storageKey: string;
  /** Query parameter name -> rule. The same names are the keys of `values`. */
  fields: Record<K, UrlFieldRule>;
  /** The fields also remembered in this browser. Search text and ids brought from elsewhere stay out. */
  remember: readonly NoInfer<K>[];
  values: Record<K, string>;
  page: number;
  /** Set the page's state. Called on mount and whenever the address changes from outside (a link, back). */
  restore: (values: Record<K, string>, page: number) => void;
}): void {
  const query = useSearchParams()?.toString() ?? "";
  // The query this hook last wrote or read; a change to anything else came from outside.
  const known = useRef<string | null>(null);
  // As in `useRememberedFilters`: the first-rendered state until it first changes, so that the defaults
  // of the first render are never written over the address or over what was stored.
  const pristine = useRef<string | null>(null);
  const serialized = JSON.stringify([values, page]);

  useEffect(() => {
    if (pristine.current === null || serialized === pristine.current) return;
    pristine.current = "";
    writeFilters(storageKey, Object.fromEntries(remember.map((k) => [k, values[k] ?? ""])));
    const timer = setTimeout(() => {
      // Read the address at write time: another parameter may have changed during the pause.
      const { pathname, search, hash } = window.location;
      const current = new URLSearchParams(search).toString();
      const next = buildUrlQuery(current, fields, values, page);
      known.current = next;
      if (next === current) return;
      // `null`, as Next's docs write it: passing the current state (which carries Next's `__NA` marker) makes
      // Next skip its own sync, and `useSearchParams` would not follow.
      window.history.replaceState(null, "",`${pathname}${next ? `?${next}` : ""}${hash}`);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `serialized` is `values` + `page`
  }, [serialized]);

  useEffect(() => {
    if (query === known.current) return;
    known.current = query;
    const fromUrl = parseUrlFilters(query, fields);
    if (pristine.current === null && !fromUrl.named) {
      const saved = readFilters(storageKey, remember);
      const merged = { ...fromUrl.values };
      for (const k of remember) merged[k] = accept(fields[k], saved[k] ?? null);
      restore(merged, 1);
    } else {
      restore(fromUrl.values, fromUrl.page);
    }
    if (pristine.current === null) pristine.current = serialized;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read on mount and when the address changes
  }, [query]);
}
