/**
 * The ports this package needs from whatever client embeds it.
 *
 * WHY THESE AND NOT "A COOKIE JAR". The web build stores the refresh token in
 * a cookie because `frontend/middleware.ts` — which runs on the server, before
 * any of this code — reads `soulledger_refresh` off the request to decide
 * whether to admit a route. A React Native client has no middleware and no
 * cookies. So the port cannot be "cookies"; it has to be the property the auth
 * design actually rests on, which is **lifetime**:
 *
 *   session    — dies when the session does (web: sessionStorage, one tab)
 *   persistent — survives a restart (web: a cookie, so middleware can read it)
 *
 * That split is not incidental. The access token lives in `session` and the
 * refresh token in `persistent`, and the whole of the commentary in
 * `../api/client.ts` is about what went wrong the one time the access token was
 * written to the persistent store. Naming the stores after their lifetimes is
 * what lets that rule be stated in this package at all; "cookie vs
 * sessionStorage" could only ever be stated in the web build.
 *
 * SYNCHRONOUS, DELIBERATELY, AND THIS CONSTRAINS THE NATIVE ADAPTER. Both
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
 * Run `handler` when the session is about to go away; returns an unsubscribe.
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
 * The default does nothing and returns a no-op unsubscribe. A host that
 * registers none loses held verdicts on exit — which is the honest behaviour
 * of a platform that has no such event, not a silent failure.
 */
export type SessionSuspendSubscriber = (handler: () => void) => () => void;

export interface PlatformAdapter {
  /** Cleared when the session ends. Holds the access token, and nothing else. */
  session: KeyValueStore;
  /** Survives a restart. Holds the refresh token and the tenant id. */
  persistent: KeyValueStore;
  /** Called once a 401 could not be recovered from. */
  onUnauthorized: UnauthorizedHandler;
  /** Subscribe to "the client is going away". See `SessionSuspendSubscriber`. */
  onSessionSuspend: SessionSuspendSubscriber;
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
