/**
 * The ports this package needs from whatever client embeds it.
 *
 * WHY THESE AND NOT "A COOKIE JAR". The web build stores the refresh token in
 * a cookie because `frontend/middleware.ts` — which runs on the server, before
 * any of this code — reads `soulledger_refresh` off the request to decide
 * whether to admit a route. A React Native client has no middleware and no
 * cookies. So the port cannot be "cookies"; it has to be the properties the
 * auth design actually rests on, which are **lifetime** and **sensitivity**:
 *
 *   session    — dies when the session does (web: sessionStorage, one tab)
 *   persistent — survives a restart, holds nothing secret (web: a cookie, so
 *                middleware can read it)
 *   secure     — survives a restart AND holds a bearer credential (web: the
 *                same cookie, for the middleware reason above)
 *
 * That split is not incidental. The access token lives in `session`, the
 * refresh token in `secure` and the tenant id in `persistent`, and the whole of
 * the commentary in `../api/client.ts` is about what went wrong the one time
 * the access token was written to the persistent store. Naming the stores after
 * their lifetimes is what lets that rule be stated in this package at all;
 * "cookie vs sessionStorage" could only ever be stated in the web build.
 *
 * WHY `secure` IS A SEPARATE PORT FROM `persistent`, EVEN THOUGH WEB MAPS BOTH
 * TO THE SAME COOKIE JAR. These two stores held the same two values until the
 * split: `REFRESH_TOKEN_KEY` and `TENANT_ID_KEY`, side by side in `persistent`.
 * On the web that is harmless — both are cookies either way. It stops being
 * harmless the moment a second host exists, because the obvious React Native
 * implementation of "survives a restart" is AsyncStorage, which is unencrypted
 * plaintext on disk, world-readable to anything that can read the app's
 * sandbox. A tenant id there is a tenant id. A refresh token there is a
 * seven-day credential (see the `max-age=604800` in
 * `frontend/lib/platform/web.ts`) sitting in a plaintext file.
 *
 * A single `persistent` port cannot express that difference, so an RN adapter
 * written against it would be *correct* — one store, one implementation — and
 * would still leak the token. Splitting the port makes the routing a decision
 * the adapter author has to make rather than one they can take by default: an
 * adapter must supply `secure` explicitly, and Keychain / EncryptedSharedPrefs
 * is what belongs there. Note that `expo-secure-store` is async, so an RN
 * `secure` store has the mirror obligation described under SYNCHRONOUS below —
 * which is the second reason this is a separate port and not a flag on the
 * first: the two stores will not have the same implementation shape.
 *
 * The alternative was to keep one port and tag keys by sensitivity. That was
 * rejected because the tag would have to be consulted by the adapter, and an
 * adapter that ignores it compiles. A missing `secure` does not compile.
 *
 * DONE NOW RATHER THAN WITH THE RN ADAPTER, deliberately: adding a port costs
 * one field, while adding it afterwards means migrating tokens already written
 * to plaintext on devices in the field, which is a data migration and not an
 * edit.
 *
 * SYNCHRONOUS, DELIBERATELY, AND THIS CONSTRAINS THE NATIVE ADAPTER. All three
 * stores are read from inside an Axios request interceptor and from
 * `WSClient.connect()`, neither of which is async today. `expo-secure-store` is
 * async, so a React Native adapter cannot call it from here — it must hydrate
 * an in-memory mirror at startup, serve reads from that, and write through in
 * the background. That is a real obligation on whoever writes it, recorded
 * here rather than discovered there.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** What the client does when a refresh has failed and the user is no longer
 *  authenticated. Web assigns `/login`; a native client resets its navigator. */
export type UnauthorizedHandler = () => void;

/**
 * Run `handler` when the session is going away; returns an unsubscribe.
 *
 * WHAT THIS IS ACTUALLY FOR, because "suspend" is vague on its own. The
 * judgment queue holds a verdict for the length of its undo window before
 * sending it. A verdict the operator gave and then walked away from is a
 * decision they made, so it has to be flushed rather than dropped — and the
 * moment to flush is the last moment the client still exists.
 *
 * That moment has a different name on every platform, which is exactly why it
 * is a port rather than a call: `beforeunload` on web, `AppState` going to
 * `background` on React Native. Neither name means anything to the other, and
 * the rule ("commit on the way out") means the same thing to both.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS MAY FIRE MANY TIMES. Write handlers accordingly.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The web implementation is `beforeunload`, which fires once and terminally,
 * and this contract used to say only "the session is about to go away" — which
 * reads as a promise that it fires once. It is not one, and cannot be: React
 * Native's `AppState` reaching `background` fires **every time the user
 * switches apps**, several times a minute, with the app fully alive after each.
 *
 * The consequence is specific and it is not hypothetical. A handler written to
 * the one-shot reading ("we are dying, flush everything") flushes the held
 * verdict on the first app switch — inside its undo window, with the undo bar
 * still on screen. Nothing errors; the operator presses undo and it does
 * nothing, because there is no longer anything held to take back. The undo
 * feature stops working and reports nothing.
 *
 * So a handler must be **idempotent** (a second call while nothing is held is a
 * no-op) and it must be **something you are willing to do on an app switch**.
 * "Flush a verdict whose undo window has not expired" is not that. See
 * `onSessionResume` for the other half.
 *
 * The default does nothing and returns a no-op unsubscribe. A host that
 * registers none loses held state on exit — which is the honest behaviour of a
 * platform that has no such event, not a silent failure.
 */
export type SessionSuspendSubscriber = (handler: () => void) => () => void;

/**
 * Run `handler` when a suspended session comes back; returns an unsubscribe.
 *
 * WHY THIS EXISTS AT ALL. `onSessionSuspend` had no counterpart, so nothing
 * could re-establish state on the way back in. That is survivable on web, where
 * suspend is terminal, and it is not on React Native, where suspend/resume is
 * an ordinary pair that happens whenever the user checks another app.
 *
 * WHAT IT IS FOR, concretely. RN freezes JS timers while the app is
 * backgrounded. `WSClient` keeps liveness with a `setInterval` heartbeat and
 * reconnects only from `onclose` (`../ws/client.ts`), so on a backgrounded
 * phone the heartbeat stops, the socket dies unobserved, and on foreground
 * there is nothing to notice: `onclose` may have fired while timers were
 * frozen, and no timer is left running to try again. The user comes back to a
 * client that reports "connected" over a dead socket. `WSClient.reconnect()`
 * already exists and already does the right thing; only the trigger was
 * missing, and this is it.
 *
 * WHY NOT A SEPARATE `onReachabilityChange`. It would have no consumer this
 * port does not already serve. The defect above is a *resume* defect — the
 * socket dies because the process was frozen, not because the network moved —
 * and a second port with no call site is the failure `onSessionSuspend` was
 * itself criticised for. Foreground network liveness is already covered by the
 * heartbeat, whose timers run in the foreground on both platforms. If a host
 * ever needs a genuine reachability signal while foregrounded (Wi-Fi to
 * cellular, say), it can be added then, with the consumer that needs it.
 *
 * SYMMETRY IS NOT PROMISED. On web this fires only on a bfcache restore, which
 * is the one event that follows `beforeunload` with the page alive again; a tab
 * merely becoming visible is not a resume, because it was never suspended.
 * On RN it fires on every return to `active`. So a handler may see a resume it
 * cannot pair with a suspend it saw, and must not depend on the pairing.
 *
 * The default does nothing and returns a no-op unsubscribe.
 */
export type SessionResumeSubscriber = (handler: () => void) => () => void;

/** How loud a notification is. Mirrors the web toast's three kinds exactly. */
export type NotifyKind = "success" | "error" | "info";

/**
 * Tell the operator something happened. Fire-and-forget; returns nothing.
 *
 * WHY THIS IS A PORT. Seven hooks in `frontend/src/hooks` end every mutation
 * with `showToast(...)`, and `showToast` is the one thing keeping them in the
 * web tree. Commit `750ea1a` left ten hooks behind on the stated grounds that
 * the four contexts they use are "全都是 DOM 耦合的 (localStorage /
 * document.cookie / classList / dataset)". For `ToastContext` that reason does
 * not hold: it touches no DOM API and holds no React state. Its provider passes
 * the same two module-level function references its default context value
 * already holds (`src/contexts/ToastContext.tsx:16` and `:23`), over a
 * module-level `let toasts: ToastItem[] = []`
 * (`src/components/ui/Toast.tsx:26`) — so a consumer behaves identically with
 * or without the provider mounted. It is a module singleton wearing a
 * context's clothes, and seven hooks were recorded as blocked by a dependency
 * that was not real.
 *
 * WHAT A NATIVE HOST DOES WITH IT. There is no `document.body` to append a div
 * to; RN shows a `ToastAndroid`, a `Snackbar`, or its navigator's banner. The
 * three kinds survive that translation and the DOM node does not, which is why
 * the port is `(message, kind)` rather than anything richer.
 *
 * WHAT THIS PORT DELIBERATELY DOES NOT SOLVE. The hooks still call `t()` to
 * turn a message key into a string before handing it over, so they still
 * cannot move into this package — `useI18n` is the other half, and moving it is
 * a separate step. This port is step one of two: it removes the *toast* reason
 * for those hooks living in `frontend/`. Step two changes this to take a
 * message key instead of a rendered string and moves the hooks in. Until then,
 * a host implementing this receives text that has already been translated by
 * the web app's i18n.
 *
 * NO RETURN VALUE, unlike the `showToast` it wraps. That function returns the
 * toast's id, for `dismissToast`. Nothing in the seven hooks uses it, and a
 * handle is the part of this API least likely to survive contact with a second
 * platform — an Android system toast cannot be dismissed by id at all. Left out
 * rather than promised and then not honoured.
 */
export type Notifier = (
  message: string,
  kind: NotifyKind,
  durationMs?: number
) => void;

export interface PlatformAdapter {
  /** Cleared when the session ends. Holds the access token, and nothing else. */
  session: KeyValueStore;
  /** Survives a restart, holds nothing secret. Holds the tenant id. */
  persistent: KeyValueStore;
  /**
   * Survives a restart and holds a bearer credential. Holds the refresh token.
   *
   * A host must give this its most protected storage — Keychain on iOS,
   * EncryptedSharedPreferences / `expo-secure-store` on Android. Web points it
   * at the same cookie jar as `persistent`, for the middleware reason at the
   * top of this file. See the long note there for why it is not `persistent`.
   */
  secure: KeyValueStore;
  /** Called once a 401 could not be recovered from. */
  onUnauthorized: UnauthorizedHandler;
  /** Subscribe to "the session is going away". **May fire many times** — see
   *  `SessionSuspendSubscriber` before writing a handler. */
  onSessionSuspend: SessionSuspendSubscriber;
  /** Subscribe to "a suspended session came back". See
   *  `SessionResumeSubscriber`. */
  onSessionResume: SessionResumeSubscriber;
  /** Show the operator a transient message. See `Notifier`. */
  notify: Notifier;
  /**
   * Where the API lives, e.g. `https://api.example.com/api/v1`. No trailing slash.
   *
   * WHY THIS IS A PORT AND NOT A CONSTANT. Three modules in this package —
   * `api/client.ts`, `ws/client.ts`, `ws/social-client.ts` — each read
   * `process.env.NEXT_PUBLIC_API_URL` directly and fell back to
   * `http://localhost:8000/api/v1`. On a phone, `localhost` is the phone. Expo
   * inlines `EXPO_PUBLIC_*` and defines no `NEXT_PUBLIC_*`; a Tauri webview
   * reads `import.meta.env.VITE_*`. Both would have taken the fallback in
   * silence and failed to reach anything.
   *
   * The package's own `package.json` calls it platform-independent and its
   * tsconfig omits `"dom"` to enforce that — but `process.env` is not a DOM
   * global, so the compiler could never have caught this. It is the same class
   * of assumption as the cookie jar, and it needed the same treatment. The
   * enforcement it was missing is `no-restricted-syntax` in this package's
   * eslint config, which now refuses `process.env` here.
   *
   * SYNCHRONOUS for the same reason the stores are: it is read inside an Axios
   * interceptor and from `WSClient.connect()`. A native adapter must have the
   * value ready before the first request rather than fetching it.
   */
  baseUrl: string;
  /**
   * The WebSocket origin, derived from `baseUrl` unless the host overrides it.
   *
   * Kept separate because the derivation — swap the scheme, drop `/api/v1` —
   * only holds when the socket is served from the API's origin. It is true for
   * every deployment today, so the default computes it; a host that terminates
   * websockets elsewhere sets this instead of being forced to lie about
   * `baseUrl`.
   */
  wsUrl?: string;
}
