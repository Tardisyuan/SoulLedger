import type {
  KeyValueStore,
  PlatformAdapter,
  SessionSuspendSubscriber,
  UnauthorizedHandler,
} from "./types";

export type { KeyValueStore, PlatformAdapter, SessionSuspendSubscriber, UnauthorizedHandler };

/** The key the access token is stored under, in the **session** store. */
export const ACCESS_TOKEN_KEY = "soulledger_access";
/** The key the refresh token is stored under, in the **persistent** store. */
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
  onUnauthorized: () => {},
  onSessionSuspend: () => () => {},
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

export function getRefreshToken(): string | null {
  return adapter.persistent.get(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(value: string): void {
  adapter.persistent.set(REFRESH_TOKEN_KEY, value);
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
