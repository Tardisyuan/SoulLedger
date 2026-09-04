import type {
  KeyValueStore,
  NotifyKind,
  Notifier,
  PlatformAdapter,
  SessionResumeSubscriber,
  SessionSuspendSubscriber,
  UnauthorizedHandler,
} from "./types";

export type {
  KeyValueStore,
  NotifyKind,
  Notifier,
  PlatformAdapter,
  SessionResumeSubscriber,
  SessionSuspendSubscriber,
  UnauthorizedHandler,
};

/** The key the access token is stored under, in the **session** store. */
export const ACCESS_TOKEN_KEY = "soulledger_access";
/**
 * The key the refresh token is stored under, in the **secure** store.
 *
 * It was in `persistent` alongside the tenant id until the two ports were
 * split. See the long note in `./types.ts` for why a seven-day bearer
 * credential and a tenant id must not share a store the moment a host exists
 * whose "persistent" is plaintext on disk.
 */
export const REFRESH_TOKEN_KEY = "soulledger_refresh";
/** The key the active tenant is stored under, in the **persistent** store. */
export const TENANT_ID_KEY = "tenant_id";

/**
 * A store that holds nothing and forgets everything.
 *
 * NOT A CONVENIENCE — it is what makes server rendering work. Every call site
 * moved into this package used to be guarded by
 * `typeof sessionStorage === "undefined"`, because Next renders these modules on
 * the server where no storage exists. That guard now lives in one place: the
 * default adapter is this, so an environment that has not called
 * `configurePlatform` reads null and writes nowhere instead of throwing.
 */
const nullStore: KeyValueStore = {
  get: () => null,
  set: () => {},
  remove: () => {},
};

const nullAdapter: PlatformAdapter = {
  session: nullStore,
  persistent: nullStore,
  secure: nullStore,
  onUnauthorized: () => {},
  onSessionSuspend: () => () => {},
  onSessionResume: () => () => {},
  // Drops the message. Same reasoning as `nullStore`: a host that has not
  // installed an adapter — Next's server render, most of all — must not throw
  // on the way to telling nobody anything.
  notify: () => {},
  // The development default, and it stays wrong on purpose for anything
  // else: a host that has not called `configurePlatform` should fail against
  // localhost during development rather than silently reach a real API. This
  // is the value three modules used to inline; it is here once now.
  baseUrl: "http://localhost:8000/api/v1",
};

let adapter: PlatformAdapter = nullAdapter;

/**
 * Install the host's storage and navigation.
 *
 * Called once, as early as possible — the web app does it from a module the
 * root layout imports, so it has run before any component can fire a query.
 * Calling it again replaces the adapter wholesale; there is no merge, because a
 * half-installed adapter is harder to reason about than a wrong one.
 */
export function configurePlatform(next: PlatformAdapter): void {
  adapter = next;
}

/** Restore the "no host installed" state. For tests. */
export function resetPlatform(): void {
  adapter = nullAdapter;
}

export function platform(): PlatformAdapter {
  return adapter;
}

/**
 * The access token, from the **session** store — never from the persistent one.
 *
 * THIS FUNCTION EXISTED THREE TIMES: `lib/api/client.ts`, `lib/ws/client.ts`
 * and `lib/ws/social-client.ts` each had their own copy, and each carried its
 * own paraphrase of the same warning. All three copies happened to agree; the
 * point is that nothing made them agree, and this repository has already been
 * bitten by two copies of a table whose values matched while their comments had
 * drifted apart (`CIVILIZATION_ICONS`, commit 1f68be0).
 *
 * The warning, once. Reading the persistent store first is the old order, and
 * it is what let a 24-hour `soulledger_access` **cookie** written by
 * `rotateRefreshToken` outrank the 30-minute value the same function had just
 * put in session storage. See the long note over `rotateRefreshToken` in
 * `../api/client.ts`. Any such leftover is cleared on the next refresh, and
 * never read.
 */
export function getAccessToken(): string | null {
  return adapter.session.get(ACCESS_TOKEN_KEY);
}

export function setAccessToken(value: string): void {
  adapter.session.set(ACCESS_TOKEN_KEY, value);
}

/**
 * The refresh token, from the **secure** store.
 *
 * Was `adapter.persistent` — identical on web, where both names point at the
 * same cookie jar, and the whole point of the change on any host where they do
 * not. See `PlatformAdapter.secure`.
 */
export function getRefreshToken(): string | null {
  return adapter.secure.get(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(value: string): void {
  adapter.secure.set(REFRESH_TOKEN_KEY, value);
}

export function getTenantId(): string {
  return adapter.persistent.get(TENANT_ID_KEY) || "";
}

/**
 * Subscribe to the client going away. Returns the unsubscribe.
 *
 * Read through `platform()` on each call rather than captured once, so a host
 * that installs its adapter after this module is first imported still gets its
 * own implementation instead of the null one.
 */
export function onSessionSuspend(handler: () => void): () => void {
  return platform().onSessionSuspend(handler);
}

/**
 * Subscribe to a suspended session coming back. Returns the unsubscribe.
 *
 * Read through `platform()` on each call, for the same reason
 * `onSessionSuspend` above is.
 *
 * NO CALL SITE IN THIS PACKAGE YET, and that is worth stating rather than
 * leaving to be discovered. The consumer this exists for is the WebSocket
 * reconnect described in `SessionResumeSubscriber` — `WSClient.reconnect()`
 * exists, this is its trigger, and the line that joins them lives in the host
 * (`frontend/src/contexts/WebSocketContext.tsx`) and has not been written.
 * Until it is, a React Native client still comes back to a dead socket; the
 * port being here does not by itself fix that.
 */
export function onSessionResume(handler: () => void): () => void {
  return platform().onSessionResume(handler);
}

/**
 * Tell the operator something happened. See `PlatformAdapter.notify`.
 *
 * Read through `platform()` on each call rather than captured once, for the
 * same reason the two subscribers above are: the adapter is installed after
 * this module is first imported.
 */
export function notify(message: string, kind: NotifyKind, durationMs?: number): void {
  platform().notify(message, kind, durationMs);
}

/**
 * Where the API lives. See `PlatformAdapter.baseUrl`.
 *
 * A function, not a constant, because the adapter is installed after this
 * module is evaluated. `api/client.ts` used to capture the value at module
 * scope (`const API_BASE_URL = process.env…`), which is exactly why it could
 * only ever come from the build environment.
 */
export function getApiBaseUrl(): string {
  return adapter.baseUrl;
}

/**
 * The notifications socket URL.
 *
 * Derived from `baseUrl` — swap the scheme, drop the `/api/v1` suffix — unless
 * the host supplies `wsUrl`. Both WebSocket clients carried their own identical
 * copy of this two-line derivation; the drift risk is the one `getAccessToken`
 * above exists to close.
 */
export function getWebSocketUrl(): string {
  if (adapter.wsUrl) return adapter.wsUrl;
  return (
    adapter.baseUrl.replace(/^http/, "ws").replace("/api/v1", "") +
    "/ws/notifications/"
  );
}
