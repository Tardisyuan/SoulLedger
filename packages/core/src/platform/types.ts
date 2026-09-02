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
}
