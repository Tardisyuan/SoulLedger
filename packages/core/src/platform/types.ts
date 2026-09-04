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
 * refresh token in `secure`, and the tenant id and the judgment queue's held
 * verdict in `persistent` (see `PlatformAdapter.persistent` for why a verdict
 * is not in `secure`), and the whole of
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
 * Which kind of suspend this is — the one thing a handler cannot work out for
 * itself, and the thing that decides what it is allowed to do.
 *
 *   "terminal"   the client is ending. This is the last moment anything can be
 *                sent. Web's `beforeunload` is this, and is only this.
 *   "transient"  the client is being put in the background and expects to come
 *                back. React Native's `AppState` reaching `background` is this:
 *                it fires **every time the user switches apps**, several times
 *                a minute, with the app fully alive after each.
 *
 * WHY THE HANDLER HAS TO BE TOLD, rather than tolerating both. The two demand
 * opposite behaviour from the same handler, and the difference is not one the
 * handler can infer. `useJudgmentQueue` holds a verdict for eight seconds so it
 * can be taken back. On a terminal suspend it must send it — the alternative is
 * losing a decision the operator made. On a transient one it must NOT: the undo
 * window is still open, the undo bar is still on screen, and sending is the
 * defect this argument exists to fix (recorded, unfixed, in `c8863fb`; the
 * verdict went out seconds into an eight-second window and undo then silently
 * did nothing).
 *
 * "Persist instead of sending" is not a substitute for the distinction either.
 * Persisting is what makes a transient suspend survivable, but on a terminal
 * suspend there is no next launch that is allowed to replay the record — a
 * verdict restored after its window has passed must be discarded, not sent —
 * so a client that only persisted would lose every verdict it did not send.
 * Both halves are needed, and only the host knows which half applies.
 */
export type SessionSuspendKind = "terminal" | "transient";

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
 * Still true, and still the first thing to know. React Native's `AppState`
 * reaching `background` fires on every app switch. Even the web's
 * `beforeunload` is not guaranteed once: a navigation another listener cancels
 * fires it again on the next attempt. So a handler must be **idempotent** — a
 * second call while nothing is held is a no-op.
 *
 * WHAT CHANGED, AND WHY THE OLD ADVICE WAS NOT ENOUGH. This contract used to
 * add "and it must be something you are willing to do on an app switch", which
 * left the handler with one behaviour for two events and no way to tell them
 * apart. `useJudgmentQueue`'s honest options were then "commit early on every
 * app switch" (undo stops working) or "never commit" (a closed tab loses the
 * verdict); it took the first, and the second is not better. `kind` is what
 * lets it take neither — see `SessionSuspendKind`.
 *
 * A HOST MUST NOT REPORT A TRANSIENT SUSPEND AS TERMINAL. Getting it wrong in
 * that direction sends a verdict that is still inside its undo window; getting
 * it wrong in the other direction loses one. Neither errors, and neither is
 * visible from inside this package. If a platform genuinely cannot tell — an
 * event that is sometimes the end and sometimes not — report `"transient"` and
 * rely on the persisted copy, because a lost verdict leaves the case pending
 * and back in the queue, while a sent one is judicial history.
 *
 * See `onSessionResume` for the other half: a transient suspend that comes back
 * has to re-check its timers against the wall clock, because the ones it left
 * running were frozen.
 *
 * The default does nothing and returns a no-op unsubscribe. A host that
 * registers none loses held state on exit — which is the honest behaviour of a
 * platform that has no such event, not a silent failure.
 */
export type SessionSuspendSubscriber = (
  handler: (kind: SessionSuspendKind) => void
) => () => void;

/**
 * One request, delivered on the way out — after the point where an ordinary
 * one is abandoned.
 *
 * WHY THIS EXISTS. `useJudgmentQueue`'s terminal flush called `judgmentApi
 * .conclude(...)`, which is axios, which is XHR. **A document that unloads
 * aborts its in-flight XHRs.** So a tab closed inside the undo window issued a
 * request that was cancelled by the very event that triggered it — and, because
 * the flush cleared the persisted record first, there was nothing left on disk
 * for the next session to recover either. The verdict was lost twice over, in
 * silence, and no test could see it: jsdom has no unload, and the mock resolved.
 *
 * NOT `sendBeacon`, AND THIS IS THE WHOLE REASON THE PORT HAS THIS SHAPE.
 * `navigator.sendBeacon` is the API this problem is usually named after, and it
 * cannot be used here: it sends no author-defined headers, and this API takes
 * its credential in `Authorization: Bearer` (`api/client.ts:103`). A beacon
 * would arrive unauthenticated and be refused — a delivery mechanism that
 * reliably fails is worse than none, because it looks like one that works.
 * `fetch(..., { keepalive: true })` carries headers and outlives the document,
 * so that is what the web adapter uses; the 64KB body limit it comes with is
 * not a constraint for a verdict.
 *
 * THE HOST GETS A FINISHED REQUEST, not a path and a payload. The URL, the
 * bearer token and the JSON body are assembled in this package, where the API
 * contract already lives, so a host cannot get the credential wrong and there
 * is no second place that knows how this app authenticates. The host supplies
 * only the platform's answer to "send this even though we are dying".
 *
 * THE RETURN VALUE IS `accepted`, NOT `delivered`, and the difference is the
 * point: nothing on this path can observe a response — the document is gone
 * before one arrives. `true` means the host handed it to the platform, and the
 * caller must treat that as *may have arrived*, never as *did*. That
 * uncertainty is why the record stays on disk with a stamp and why the next
 * session asks the server what actually happened, rather than assuming either
 * way.
 *
 * The default returns `false`: a host that has installed no adapter, and one
 * running under a server render, genuinely cannot deliver anything. Saying so
 * lets the caller keep the record instead of dropping it against a promise
 * nobody kept.
 */
export type TerminalDelivery = (request: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) => boolean;

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
 * Placeholder values for a message key that has them, e.g. `{name}`.
 *
 * NO CALL SITE IN THIS PACKAGE TODAY, and that is worth stating rather than
 * leaving to be found. Every one of the 26 notifications this port carries is
 * a fixed sentence. It is here anyway because the alternative is a cliff with
 * no workaround: the hooks that call `notify` no longer hold `t`, so a message
 * that needs to name the thing it happened to ("Soul {name} created") would be
 * unexpressible from inside this package, and the only way out would be to put
 * a translator back into it. `t()` has taken `params` since it was written; the
 * port is mirroring a capability the host already has, not inventing one.
 *
`string` values only, and that is the host's shape rather than a preference:
 * `useI18n().t` splices values into the bundle string with a regex replace and
 * takes `Record<string, string>`. Allowing `number` here would type-check on
 * this side and not on the other, and widening `t` to fix it would be a change
 * to every `t()` in the app in service of a feature with no call site. A caller
 * with a number writes `String(n)`, which is what every existing `t()` caller
 * already does.
 */
export type NotifyParams = Record<string, string>;

/**
 * What to say. A **message key**, resolved by the host — not a rendered string.
 *
 * WHY A KEY AND NOT THE TEXT. Step one of this change made `notify` a port and
 * left the seven hooks in `frontend/` calling `t(...)` before handing the
 * result over. That kept `useI18n` — a React context in the web tree — as the
 * hooks' last binding to the browser, and `t()` alone was worth 26 of the 26
 * remaining `t(` calls across `frontend/src/hooks`: the entire i18n coupling of
 * that layer was translating toast copy. Moving the resolution to the host
 * removes it, and it puts the resolution where the locale actually lives.
 *
 * A React Native host resolves the same key against the same three bundles in
 * `../../messages`, which are already part of this package. Nothing about a
 * key is web-shaped.
 *
 * THE THREE FORMS, AND WHY THE THIRD EXISTS.
 *
 *   "souls.form.create_success"              a key
 *   { key: "souls.x", params: { name } }     a key with placeholders
 *   { text: "Cannot follow yourself." }      text that has no key
 *
 * The last one is not an escape hatch for laziness and must not become one.
 * Four call sites in `useSocial` show the message DRF put in
 * `non_field_errors` — "Cannot react to a post from another tenant." — which is
 * written by the server, per request, and cannot be a key in a bundle shipped
 * with the client. Without this form the only options were to drop the server's
 * reason (the operator is then told "Failed to react" and not why) or to invent
 * a copy convention that splices the two together. Both are worse than naming
 * the case.
 *
 * A bare string is read as a key, so a literal English sentence passed here
 * renders as itself — `t()` returns the key it could not find. That is a quiet
 * trap, and it is closed by a guard rather than by the type system:
 * `frontend/src/__tests__/notifyKeysExistInTheBundles.test.ts` reads every
 * string literal passed to `notify` out of the source and fails if it is not a
 * real key in all three bundles.
 */
export type NotifyMessage =
  | string
  | { key: string; params?: NotifyParams }
  | { text: string };

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
 * THE HOST RESOLVES THE MESSAGE. See `NotifyMessage`. This was
 * `(message: string, …)` for exactly one commit, during which the hooks called
 * `t()` themselves; that was step one of two and the doc here said so.
 *
 * NO RETURN VALUE, unlike the `showToast` it wraps. That function returns the
 * toast's id, for `dismissToast`. Nothing in the seven hooks uses it, and a
 * handle is the part of this API least likely to survive contact with a second
 * platform — an Android system toast cannot be dismissed by id at all. Left out
 * rather than promised and then not honoured.
 */
export type Notifier = (
  message: NotifyMessage,
  kind: NotifyKind,
  durationMs?: number
) => void;

export interface PlatformAdapter {
  /** Cleared when the session ends. Holds the access token, and nothing else. */
  session: KeyValueStore;
  /**
   * Survives a restart, holds nothing secret. Holds the tenant id, and the
   * judgment queue's held verdict.
   *
   * WHY A HELD VERDICT IS HERE AND NOT IN `secure`, since it is plainly more
   * sensitive than a tenant id — a verdict, a note and a soul's name. Three
   * reasons, and the first is the one that decides it:
   *
   *  1. `secure`'s documented native shape is `expo-secure-store` / Keychain,
   *     which is **async**, which is why SYNCHRONOUS above obliges a native
   *     adapter to serve reads from an in-memory mirror and *write through in
   *     the background*. A record whose entire purpose is to be on disk at the
   *     instant the process is killed cannot live behind a background write.
   *  2. Keychain items survive an app being uninstalled and reinstalled. A
   *     verdict that outlives the install that made it is the replay hazard in
   *     its worst form; `persistent` (AsyncStorage) goes with the app.
   *  3. It is not a credential. Nothing can be authenticated with it, which is
   *     the property `secure` was split out to protect. Widening `secure` to
   *     "anything sensitive" would make the routing a judgement call again,
   *     which is exactly what the split removed.
   *
   * Its confidentiality is bought with **lifetime** instead: it is written only
   * while a verdict is held (eight seconds, in the ordinary case), and removed
   * on commit, on undo, and on being read back — see the header of
   * `../hooks/useJudgmentQueue.ts`.
   */
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
  /** Subscribe to "the session is going away". **May fire many times**, and
   *  the handler is told whether this one is `"terminal"` or `"transient"` —
   *  see `SessionSuspendSubscriber` and `SessionSuspendKind` before writing a
   *  handler or an adapter. */
  onSessionSuspend: SessionSuspendSubscriber;
  /** Subscribe to "a suspended session came back". See
   *  `SessionResumeSubscriber`. */
  onSessionResume: SessionResumeSubscriber;
  /** Show the operator a transient message. See `Notifier`. */
  notify: Notifier;
  /** Deliver one request while the session is being torn down. See
   *  `TerminalDelivery` — the default returns `false`, which is honest. */
  deliverOnExit: TerminalDelivery;
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
