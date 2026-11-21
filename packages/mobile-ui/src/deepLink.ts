/**
 * Deep links, the part both apps share (the officer app borrows it through its shared.ts).
 *
 * `pathOf` is pure: the segments after `scheme://`, or null for any other URL. `createLinkInbox`
 * keeps the latest parsed link until somebody who can act on it (signed in, navigator ready)
 * subscribes -- so a link opened while signed out is applied after login, and an unknown link
 * is dropped here and never reaches a screen. Voice and launcher shortcuts only ever OPEN a page.
 */
import { Linking } from "react-native";

/** `soulledger://letters/` -> ["letters"]. Null when the scheme differs. Never throws. */
export function pathOf(url: unknown, scheme: string): string[] | null {
  if (typeof url !== "string") return null;
  const prefix = `${scheme}://`;
  if (!url.toLowerCase().startsWith(prefix)) return null;
  const rest = url.slice(prefix.length).split(/[?#]/)[0];
  try {
    return rest.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** One query parameter of a link, percent-decoded (`+` is a space). Null when absent or malformed. Never throws. */
export function queryOf(url: unknown, name: string): string | null {
  if (typeof url !== "string") return null;
  const query = url.split("#")[0].split("?")[1];
  if (!query) return null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent((eq < 0 ? "" : pair.slice(eq + 1)).replace(/\+/g, " "));
    } catch {
      return null;
    }
  }
  return null;
}

export function createLinkInbox<T>(parse: (url: string) => T | null) {
  let pending: T | null = null;
  let installed = false;
  const subscribers = new Set<(link: T) => void>();

  function push(url: unknown): void {
    const link = typeof url === "string" ? parse(url) : null;
    if (!link) return;
    if (subscribers.size === 0) pending = link;
    else subscribers.forEach((fn) => fn(link));
  }

  return {
    push,
    /** Calls `fn` for the held link (if any) now and for every later one, until the returned off(). */
    subscribe(fn: (link: T) => void): () => void {
      subscribers.add(fn);
      if (pending) {
        const held = pending;
        pending = null;
        fn(held);
      }
      return () => {
        subscribers.delete(fn);
      };
    },
    /** At module load, once: every link that arrives while the app is running. */
    install(): void {
      if (installed) return;
      installed = true;
      Linking.addEventListener("url", ({ url }) => push(url));
    },
    /**
     * On every mount of the root component: the link that opened this activity. Not at module load --
     * an Android launcher shortcut starts the activity with CLEAR_TASK, so the activity is recreated
     * inside the same JS runtime, the root remounts, and no "url" event fires (seen 2026-10-09: the
     * "Ask" shortcut opened the app on its default page). Read once per JS runtime, that link was lost.
     */
    readOpening(): void {
      // A new root mount means the previous tree is gone, and on a real phone (Huawei, Android 12,
      // 2026-10-10) its effects were never cleaned up: the old subscriber was still in the set, got
      // the new link, and navigated a container that no longer existed ("navigation object hasn't
      // been initialized"), so the link was lost. Subscribers of this mount register later, when
      // signed in and ready; until then the link waits in `pending`.
      subscribers.clear();
      Linking.getInitialURL()
        .then(push)
        .catch(() => {});
    },
  };
}
