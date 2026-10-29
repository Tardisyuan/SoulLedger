"use client";

import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  configurePlatform,
  type KeyValueStore,
  type NotifyMessage,
  type PlatformAdapter,
} from "@soulledger/core/platform";
import { showToast } from "@/src/components/ui/Toast";
import { translate } from "@/lib/i18n/activeTranslator";

/**
 * The browser's half of `@soulledger/core`'s platform port.
 *
 * This file is the ONLY place in the repository that knows the access token
 * lives in `sessionStorage` and the refresh token in a cookie. The package
 * knows only that one store dies with the session, one survives a restart, and
 * one survives a restart while holding a credential; everything cookie-shaped
 * is here, because a cookie is a thing only a browser has.
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

/** How long the signed-in marker cookie lives (seconds): the longest a refresh token can (「保持登录 30 天」). */
export const MARKER_MAX_AGE = 30 * 24 * 3600;

/**
 * The persistent half: a cookie, plus `localStorage` on the read path.
 *
 * WHY A COOKIE AND NOT `localStorage`. `frontend/proxy.ts` runs on the
 * server, before any of this, and reads `soulledger_refresh` off the request to
 * decide whether to admit a route. `localStorage` is invisible to it. That is
 * the whole reason the refresh token is a cookie, and it is why this port could
 * not have been modelled as "one storage API" — the two halves differ in who
 * can read them, not just in how long they last.
 *
 * WHY `localStorage` IS STILL ON THE READ PATH. Everything `set` below writes
 * that is not the refresh token goes to `localStorage` (the locale is read the
 * same way), so `get` checks there first and falls through to the cookie —
 * the refresh token is never in `localStorage`, so it always falls through.
 * (This note used to say `TenantContext` wrote `tenant_id` there. Nothing did;
 * the key and the `X-Tenant-ID` header it fed were deleted, FL-12.)
 *
 * `set` BRANCHES ON THE KEY, and the note that used to be here said why it
 * would have to: "the attributes below are the refresh token's… if that ever
 * stops being true, this function has to branch on the key rather than quietly
 * give some other value a seven-day lifetime." That stopped being true when
 * `useJudgmentQueue` began persisting the verdict it is holding, so the branch
 * is written.
 *
 * The refresh token keeps the cookie, for the middleware reason above and for
 * no other. Everything else goes to `localStorage`, which is where a persistent
 * non-credential already belonged, and `get` above has always read
 * `localStorage` first — so this makes `set` agree with the `get` it was
 * already paired with.
 *
 * The alternative, leaving it as one cookie write, is worse in three ways that
 * are all specific rather than stylistic: a held verdict (a soul's name, a
 * verdict, the operator's note) would be sent to the Next server on every
 * request to this origin, for no reader; it would carry the refresh token's lifetime —
 * days, on a record whose design lifetime is eight seconds; and
 * cookies are capped near 4KB per origin, shared with the refresh token.
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
    // Not the refresh token: `localStorage`, and nothing leaves the browser.
    // `get` reads there first, so this round-trips.
    if (key !== REFRESH_TOKEN_KEY) {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, value);
      return;
    }
    if (typeof document === "undefined") return;
    // 2026-10-29 (decision 16): THE TOKEN IS NO LONGER HERE. The API sets it as an httpOnly, SameSite=Strict
    // cookie on its own origin (`backend/apps/authentication/refresh_cookie.py`), which no script can read.
    // What this cookie holds now is only the marker "1" — signed in — for `proxy.ts`, which runs on this
    // origin and cannot see the API's cookie. Whatever value a caller passes, the token is never written:
    // a marker that leaked would say nothing an attacker could use.
    //
    // 30 days, the longest a session can last: if the real cookie dies first, the next API call's refresh
    // fails and `endSession` removes this marker. `Secure` wherever `Secure` can work (plain-http dev and
    // Playwright would drop it).
    const secure =
      typeof location !== "undefined" && location.protocol === "https:"
        ? "; Secure"
        : "";
    void value;
    document.cookie = `${key}=1; path=/; max-age=${MARKER_MAX_AGE}; SameSite=Lax${secure}`;
  },
  remove(key) {
    if (typeof document === "undefined") return;
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    document.cookie = `${key}=; path=/; max-age=0`;
  },
};

/**
 * A `NotifyMessage` as words.
 *
 * Exported for the guard tests, which assert against this rather than against a
 * paraphrase of it — the point of the port is that this function is the only
 * place a key becomes a sentence on the web.
 *
 * `{ text }` passes through untouched, and that is the whole reason it exists:
 * DRF writes those strings per request (`non_field_errors`), so no bundle
 * shipped with the client can hold them. See `NotifyMessage`.
 */
export function renderNotifyMessage(message: NotifyMessage): string {
  if (typeof message === "string") return translate(message);
  if ("text" in message) return message.text;
  return translate(message.key, message.params);
}

export const webPlatform: PlatformAdapter = {
  session,
  persistent,
  // The same object, on purpose, and this is the one host where that is right.
  //
  // The package splits `persistent` from `secure` because "survives a restart"
  // and "is a bearer credential" are different properties, and a React Native
  // adapter that conflates them puts a 7- or 30-day refresh token into AsyncStorage
  // plaintext. A browser has no such choice to make: the refresh token has to be
  // a cookie so `frontend/proxy.ts` can read it (see the note over
  // `persistent` above), and a cookie is the most protected store this platform
  // offers for a value JS must also be able to read. So both ports point here.
  //
  // Which means the split changes nothing about web behaviour, deliberately.
  // What it changes is that the next adapter cannot make the same aliasing
  // silently — it has to write this line, and writing it is where the decision
  // gets made.
  secure: persistent,
  // The refresh token is an httpOnly cookie the API sets (decision 16); see `persistent.set` above.
  refreshCookie: true,
  // The one place `NEXT_PUBLIC_API_URL` is read. It is a Next.js build-time
  // variable, so it belongs to this host and not to `@soulledger/core`, which
  // read it directly in three modules and fell back to localhost when it was
  // absent — silently, in any host that is not Next. `packages/core`'s eslint
  // config now refuses `process.env` outright, so the fallback cannot come
  // back by accident.
  baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
  onSessionSuspend(handler) {
    // `beforeunload` is this platform's name for "the client is going away".
    // It is the only such event a browser has that fires early enough to send
    // a request, and it is the reason `useJudgmentQueue` no longer names it:
    // the hook states the rule, this states the browser.
    //
    // `"terminal"`, always, because this event is: after it the page is gone
    // and nothing can be sent. That is the argument `useJudgmentQueue` reads to
    // decide it may commit a verdict that is still inside its undo window, and
    // it is why the web path here is byte-for-byte the behaviour it had before
    // the kind existed.
    //
    // STILL NOT `visibilitychange`. The reason has changed and the answer has
    // not. It used to be that the hook could not tolerate a transient suspend;
    // it can now, and would merely re-save a record it has already saved. What
    // is left is that a hidden tab on this platform is not a suspended session:
    // its timers keep running, the undo window keeps elapsing correctly, and
    // the verdict is already persisted at the moment it is given rather than at
    // the moment of a suspend. So the event would have nothing to do here, and
    // adding an event with no consumer is what `onSessionResume` was criticised
    // for in `c8863fb`. A browser discarding a hidden tab outright is the one
    // case it would cover, and the persisted record covers that already.
    if (typeof window === "undefined") return () => {};
    const onBeforeUnload = () => handler("terminal");
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  },
  onSessionResume(handler) {
    // A bfcache restore, and only that.
    //
    // The port is "a suspended session came back", and on this platform the
    // only thing that suspends a session is the `beforeunload` above. The one
    // way a page comes back from it with its JavaScript alive is the back/
    // forward cache, which announces itself as `pageshow` with
    // `persisted === true`. A plain `pageshow` — the ordinary first paint — is
    // not a resume, because nothing was suspended, and firing on it would hand
    // every handler a resume event on page load.
    //
    // React Native's implementation is `AppState` reaching `active`, which
    // fires far more often. That asymmetry is stated in the port's own doc
    // rather than papered over here: a handler must not assume it sees a
    // suspend for every resume, or a resume for every suspend.
    if (typeof window === "undefined") return () => {};
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) handler();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  },
  notify(message, kind, durationMs) {
    // The browser's spelling of "tell the operator something happened": a
    // fixed-position div appended to `document.body`, built by
    // `src/components/ui/Toast.tsx`.
    //
    // The package hands over a message **key**; turning it into words is this
    // host's job and happens here. `renderNotifyMessage` calls the very
    // `useI18n().t` the rest of the app renders with — `lib/i18n/activeTranslator`
    // holds the reference — rather than a second walk over the bundles, which
    // would agree with `t` only until one of the two changed.
    //
    // `showToast` returns the toast's id and this returns nothing, which is
    // deliberate — see `Notifier` in the package. `durationMs` is forwarded as
    // given, including `undefined`, so `showToast`'s own default (4000ms since 规范 v3) keeps
    // applying to callers that omit it; that is what the seven hooks did
    // before they went through this port, and behaviour there must not change.
    showToast(renderNotifyMessage(message), kind, durationMs);
  },
  onUnauthorized() {
    // The one line in the old `lib/api/client.ts` that assumed a browser with a
    // URL bar. A native client resets its navigator here instead.
    if (typeof window === "undefined") return;
    // The cached user (TenantContext's `soulledger_user`) goes with the tokens. Left behind, the next page load
    // restored a "signed-in" user whose session the server had ended (another device's 「退出其他全部」, a reset,
    // a password change), fetched its permissions, got this 401 again -- and on /login/verify that bounced the
    // operator back to /login on every attempt: no way in until the browser's storage was cleared by hand
    // (2026-10-16, found in the browser).
    try {
      window.localStorage.removeItem("soulledger_user");
    } catch {
      // storage unavailable: nothing cached to clear
    }
    // Anywhere under /login (the form, the two-step page) the operator is already on the way in: navigating
    // would reload, drop what they typed, and re-fire this. FL-20 covered /login alone; /login/verify was missed.
    if (window.location.pathname === "/login" || window.location.pathname.startsWith("/login/")) return;
    window.location.href = "/login";
  },
};

/** Names re-exported so the guard tests can assert against the same constants
 *  the adapter uses, rather than against two copies of two strings. */
export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY };

export function installWebPlatform(): void {
  configurePlatform(webPlatform);
}
