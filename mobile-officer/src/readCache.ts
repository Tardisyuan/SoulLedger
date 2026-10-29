/**
 * The read cache (Design batch 28 O3): what the officer last saw, so a dropped network still shows it.
 *
 * WHAT IS KEPT. The to-do list (`list:todo`, which carries the letters group), the judgment queue's
 * first page per group (`list:queue:<group>`), the first page of 通知 (`list:notices`), and the
 * DETAIL_KEEP most recently opened details (`detail:<kind>:<id>`: approval / dispatch / rebirth /
 * cooldown / letter threads / judgments; a judgment's comments are not kept). One JSON value in the persistent store. Pictures are NOT kept: a picture that cannot load
 * offline is a grey block (letterImages.tsx).
 *
 * WHEN IT IS USED. Offline -- or when a request dies without any answer from the server -- and only
 * then. A server that ANSWERS (403, 404, 500) is shown as what it said, never papered over with old
 * data. It is a read cache: nothing here is ever sent back.
 *
 * WHEN IT GOES. `clearReadCache()` on sign-out and on a session the server ended (session.tsx), beside
 * `clearDrafts()`: the next officer on the phone must not find the last one's cases. Stored as
 * `{ owner, lists, details }` (owner.ts), so whatever a path that did not clear left behind reads as empty.
 */
import { platform } from "@soulledger/core/platform";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { readOwned, writeOwned } from "./owner";
import { useOnline, useReloadOnReconnect, useRemote } from "./shared";

export const CACHE_KEY = "officer_read_cache";
export const DETAIL_KEEP = 20;

interface Entry {
  key: string;
  at: number;
  data: unknown;
}
interface Store {
  lists: Entry[];
  details: Entry[]; // newest first
}

function read(): Store {
  const parsed = readOwned<Partial<Store>>(CACHE_KEY);
  return { lists: Array.isArray(parsed?.lists) ? parsed.lists : [], details: Array.isArray(parsed?.details) ? parsed.details : [] };
}

export function cacheRead<T>(key: string): { at: number; data: T } | null {
  const store = read();
  const hit = [...store.lists, ...store.details].find((e) => e.key === key);
  return hit ? { at: hit.at, data: hit.data as T } : null;
}

/** Keys starting `list:` are kept always; any other key is a detail, and only the newest DETAIL_KEEP stay. */
export function cacheWrite(key: string, data: unknown): number {
  const at = Date.now();
  const store = read();
  const entry: Entry = { key, at, data };
  if (key.startsWith("list:")) store.lists = [entry, ...store.lists.filter((e) => e.key !== key)];
  else store.details = [entry, ...store.details.filter((e) => e.key !== key)].slice(0, DETAIL_KEEP);
  try {
    writeOwned(CACHE_KEY, store);
  } catch {
    // A full store loses the cache, never the screen.
  }
  return at;
}

export function clearReadCache(): void {
  platform().persistent.remove(CACHE_KEY);
  setShownAt(null);
}

// ── the time the banner names ───────────────────────────────────────────

let shown: number | null = null;
const listeners = new Set<() => void>();

function setShownAt(at: number | null): void {
  if (shown === at) return;
  shown = at;
  listeners.forEach((l) => l());
}

/**
 * Each mounted screen that reads through the cache says what it shows: the time of its content, or null when
 * it has none (a miss offline: 「没取到」). The banner names the one opened last -- the screen on top -- so a
 * detail with nothing in it does not borrow the list's time underneath, and going back gives the list's back.
 */
const screens: { id: number; at: number | null }[] = [];
let nextScreen = 0;

function publishScreen(id: number, at: number | null): void {
  const entry = screens.find((s) => s.id === id);
  if (entry) entry.at = at;
  else screens.push({ id, at });
  setShownAt(screens[screens.length - 1].at);
}

function dropScreen(id: number): void {
  const i = screens.findIndex((s) => s.id === id);
  if (i < 0) return;
  screens.splice(i, 1);
  setShownAt(screens.length ? screens[screens.length - 1].at : null);
}

/** When the content on screen was last fetched (or cached): 「显示的是 HH:MM 的内容」. */
export function useShownAt(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
}

const hasAnswer = (error: unknown): boolean => (error as { response?: unknown } | null)?.response != null;

/**
 * `useRemote` with the cache behind it. Online it fetches and writes the cache; offline it answers from
 * the cache without asking (a request on a dead network can hang); a request that fails with no answer
 * falls back to the cache too. Reloads by itself when the network returns.
 */
export function useCachedRemote<T>(key: string, fetcher: () => Promise<T>) {
  const { offline } = useOnline();
  const offlineNow = useRef(offline);
  useEffect(() => {
    offlineNow.current = offline;
  }, [offline]);
  const wrapped = useCallback(async () => {
    const hit = cacheRead<T>(key);
    if (offlineNow.current && hit) return { value: hit.data, at: hit.at, cached: true };
    try {
      const value = await fetcher();
      return { value, at: cacheWrite(key, value), cached: false };
    } catch (e) {
      if (!hasAnswer(e) && hit) return { value: hit.data, at: hit.at, cached: true };
      throw e;
    }
  }, [key, fetcher]);
  const { data, error, loading, reload } = useRemote(wrapped);
  useReloadOnReconnect(reload);
  const at = data?.at ?? null;
  const [screen] = useState(() => ++nextScreen);
  const missed = data === null && error != null;
  useEffect(() => {
    if (at !== null) publishScreen(screen, at);
    else if (missed) publishScreen(screen, null);
  }, [screen, at, missed]);
  useEffect(() => () => dropScreen(screen), [screen]);
  return { data: data ? data.value : null, error, loading, reload, cached: data?.cached ?? false };
}
