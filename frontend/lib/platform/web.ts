"use client";

import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  configurePlatform,
  type KeyValueStore,
  type PlatformAdapter,
} from "@soulledger/core/platform";

/**
 * The browser's half of `@soulledger/core`'s platform port.
 *
 * This file is the ONLY place in the repository that knows the access token
 * lives in `sessionStorage` and the refresh token in a cookie. The package
 * knows only that one store dies with the session and the other survives a
 * restart; everything cookie-shaped is here, because a cookie is a thing only
 * a browser has.
 *
 * SERVER-SAFE BY CONSTRUCTION. Next renders client modules on the server too,
 * where `document` and `sessionStorage` do not exist. The five
 * `typeof x === "undefined"` guards that used to be scattered through
 * `lib/api/client.ts` and the two WebSocket clients are now these three, and
 * they are the only ones — an environment that never installs this adapter
 * reads the package's null store instead of throwing.
 */

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null;
  return null;
}

/** Session storage: one tab, cleared when it closes. Holds the access token. */
const session: KeyValueStore = {
  get(key) {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(key);
  },
  set(key, value) {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(key, value);
  },
  remove(key) {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(key);
  },
};

/**
 * The persistent half: a cookie, plus `localStorage` on the read path.
 *
 * WHY A COOKIE AND NOT `localStorage`. `frontend/middleware.ts` runs on the
 * server, before any of this, and reads `soulledger_refresh` off the request to
 * decide whether to admit a route. `localStorage` is invisible to it. That is
 * the whole reason the refresh token is a cookie, and it is why this port could
 * not have been modelled as "one storage API" — the two halves differ in who
 * can read them, not just in how long they last.
 *
 * WHY `localStorage` IS STILL ON THE READ PATH. `tenant_id` is written by
 * `src/contexts/TenantContext.tsx` into `localStorage`, and was read as
 * `localStorage.getItem("tenant_id") || getCookie("tenant_id")`. Checking
 * `localStorage` first and falling through to the cookie preserves that exactly
 * — the refresh token is never in `localStorage`, so it always falls through.
 *
 * `set` writes a cookie, and the attributes below are the refresh token's. That
 * is sound because the refresh token is the only key ever written through this
 * port (`tenant_id` is written by TenantContext directly, and the access token
 * is forbidden here — see the guard test). If that ever stops being true, this
 * function has to branch on the key rather than quietly give some other value a
 * seven-day lifetime.
 */
const persistent: KeyValueStore = {
  get(key) {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(key);
      if (stored) return stored;
    }
    return readCookie(key);
  },
  set(key, value) {
    if (typeof document === "undefined") return;
    // `Secure` wherever `Secure` can work — not unconditional. Secure cookies
    // are dropped on plain http, which is what `npm run dev` and the Playwright
    // suite serve, so hardcoding it would log everyone out locally while
    // looking like a security fix. Keyed on the page's own protocol instead.
    //
    // `HttpOnly` is deliberately absent and has to be: the API is cross-origin
    // and takes its credential in an `Authorization` header, so JS must be able
    // to read this value. That is a property of the auth design, not an
    // oversight.
    const secure =
      typeof location !== "undefined" && location.protocol === "https:"
        ? "; Secure"
        : "";
    document.cookie = `${key}=${value}; path=/; max-age=604800; SameSite=Lax${secure}`;
  },
  remove(key) {
    if (typeof document === "undefined") return;
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    document.cookie = `${key}=; path=/; max-age=0`;
  },
};

export const webPlatform: PlatformAdapter = {
  session,
  persistent,
  onSessionSuspend(handler) {
    // `beforeunload` is this platform's name for "the client is going away".
    // It is the only such event a browser has that fires early enough to send
    // a request, and it is the reason `useJudgmentQueue` no longer names it:
    // the hook states the rule, this states the browser.
    if (typeof window === "undefined") return () => {};
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  },
  onUnauthorized() {
    // The one line in the old `lib/api/client.ts` that assumed a browser with a
    // URL bar. A native client resets its navigator here instead.
    if (typeof window === "undefined") return;
    window.location.href = "/login";
  },
};

/** Names re-exported so the guard tests can assert against the same constants
 *  the adapter uses, rather than against two copies of two strings. */
export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY };

export function installWebPlatform(): void {
  configurePlatform(webPlatform);
}
