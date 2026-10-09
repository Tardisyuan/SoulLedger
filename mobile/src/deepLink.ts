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
    /** At module load, once: the link that opened the app and every later one. */
    install(): void {
      if (installed) return;
      installed = true;
      Linking.getInitialURL()
        .then(push)
        .catch(() => {});
      Linking.addEventListener("url", ({ url }) => push(url));
    },
  };
}
