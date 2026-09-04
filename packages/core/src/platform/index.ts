import type {
  KeyValueStore,
  NotifyKind,
  NotifyMessage,
  NotifyParams,
  Notifier,
  PlatformAdapter,
  SessionResumeSubscriber,
  SessionSuspendKind,
  SessionSuspendSubscriber,
  TerminalDelivery,
  UnauthorizedHandler,
} from "./types";

export type {
  KeyValueStore,
  NotifyKind,
  NotifyMessage,
  NotifyParams,
  Notifier,
  PlatformAdapter,
  SessionResumeSubscriber,
  SessionSuspendKind,
  SessionSuspendSubscriber,
  TerminalDelivery,
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
 * The key the judgment queue's held verdict is stored under, in the
 * **persistent** store.
 *
 * `persistent` and not `secure`, and the argument is in
 * `PlatformAdapter.persistent` rather than here so that it sits next to the
 * store it is about. Short version: `secure`'s native shape is async and
 * write-through-in-the-background, which is disqualifying for a record whose
 * whole job is to be on disk when the process dies; and Keychain outlives an
 * uninstall, which turns a lost verdict into a replayed one.
 */
export const PENDING_VERDICT_KEY = "soulledger_pending_verdict";
/**
 * The key the held verdict's **liveness lease** is stored under, in the
 * **persistent** store, beside the record it is about.
 *
 * WHAT IT IS FOR. `persistent` is shared by every session on the device — two
 * browser tabs are two sessions over one `localStorage` — so a record found
 * there answers "somebody held a verdict" and not "somebody is still holding
 * it". Those two need telling apart in opposite directions: a session that is
 * still running will send the verdict itself and must not be raced, while a
 * session that died cannot send anything and its record must be adopted. See
 * the header of `../hooks/useJudgmentQueue.ts`.
 *
 * A SEPARATE KEY, NOT A FIELD ON THE RECORD, and the reason is a rule the
 * record has: a restored verdict is never written back, so it can be adopted at
 * most once. A stamp living inside the record would have to be re-written a few
 * times a second, which is that rule deleted. The lease is the only thing that
 * gets rewritten; the record is written once and removed once.
 *
 * The value is a wall-clock `Date.now()` as a decimal string — written by
 * whichever session currently has the record on disk, and by nothing else. It
 * is validated where it is read, for the same reason the record is: anything in
 * this store may have been written by a previous build or edited by hand.
 */
export const PENDING_VERDICT_LEASE_KEY = "soulledger_pending_verdict_lease";

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
  // `false`, and it has to be `false` rather than a no-op returning nothing:
  // the caller keeps the verdict on disk when delivery was not accepted, and
  // silently answering "accepted" here would throw away a record on the
  // strength of a send that never happened. A server render and an
  // un-configured host both genuinely cannot deliver.
  deliverOnExit: () => false,
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
 * The judgment queue's held verdict, as it was written — a JSON string, or
 * null.
 *
 * A string and not a parsed object, deliberately. The shape is
 * `useJudgmentQueue`'s and belongs to it; this layer's job is only which store
 * it lands in. Anything read back here was written by a previous process — a
 * previous *version* of the app, after an upgrade — so it is validated field by
 * field at the point of use rather than trusted for having come out of our own
 * store. See `parsePersistedVerdict` in `../hooks/useJudgmentQueue.ts`.
 */
export function getPendingVerdict(): string | null {
  return adapter.persistent.get(PENDING_VERDICT_KEY);
}

export function setPendingVerdict(value: string): void {
  adapter.persistent.set(PENDING_VERDICT_KEY, value);
}

export function clearPendingVerdict(): void {
  adapter.persistent.remove(PENDING_VERDICT_KEY);
}

/**
 * The liveness lease on the held verdict, as it was written — a decimal
 * `Date.now()` string, or null.
 *
 * A string and not a number, for the reason `getPendingVerdict` is a string and
 * not a `PendingVerdict`: what a well-formed value is, and what to do about one
 * that is not, belongs to the module that reasons about it. Null here means
 * "nothing claims the record", which is also what an unreadable value means to
 * the only caller — but that decision is made there, once, next to the rest of
 * the rules.
 */
export function getVerdictLease(): string | null {
  return adapter.persistent.get(PENDING_VERDICT_LEASE_KEY);
}

/** Stamp the lease. Called by the session that has the record on disk, often. */
export function markVerdictLease(value: string): void {
  adapter.persistent.set(PENDING_VERDICT_LEASE_KEY, value);
}

/** Drop the lease. Called wherever the record itself is dropped. */
export function clearVerdictLease(): void {
  adapter.persistent.remove(PENDING_VERDICT_LEASE_KEY);
}

/**
 * Subscribe to the client going away. Returns the unsubscribe.
 *
 * The handler is given the **kind** of suspend — `"terminal"` or
 * `"transient"`. A handler that ignores it still compiles (a function of no
 * arguments is assignable to one of one), which is the right default for the
 * handlers that would do the same thing either way, and is the wrong default
 * for anything that sends: read `SessionSuspendKind` in `./types` first.
 *
 * Read through `platform()` on each call rather than captured once, so a host
 * that installs its adapter after this module is first imported still gets its
 * own implementation instead of the null one.
 */
export function onSessionSuspend(
  handler: (kind: SessionSuspendKind) => void
): () => void {
  return platform().onSessionSuspend(handler);
}

/**
 * Subscribe to a suspended session coming back. Returns the unsubscribe.
 *
 * Read through `platform()` on each call, for the same reason
 * `onSessionSuspend` above is.
 *
 * WHO CALLS IT. `../hooks/useJudgmentQueue.ts`, to re-check a held verdict's
 * undo window against the wall clock: React Native freezes JS timers while the
 * app is backgrounded, so the `setTimeout` that would have sent the verdict is
 * late by however long the user was away, and the countdown on screen is wrong
 * by the same amount. The WebSocket reconnect described in
 * `SessionResumeSubscriber` is the other consumer and lives in the host
 * (`frontend/src/contexts/WebSocketContext.tsx`).
 *
 * This doc said "NO CALL SITE IN THIS PACKAGE YET" for the commit that added
 * the port, which was true then and is not now.
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
 *
 * `message` is a message **key**, not a rendered string — the host resolves it
 * against the bundles in `../../messages`. See `NotifyMessage` for the two
 * other forms and for why the third (`{ text }`) has to exist.
 */
export function notify(message: NotifyMessage, kind: NotifyKind, durationMs?: number): void {
  platform().notify(message, kind, durationMs);
}

/**
 * POST `body` to `path` while the session is being torn down.
 *
 * Assembles the URL, the bearer header and the content type here — see
 * `TerminalDelivery` for why the host is handed a finished request rather than
 * a path — and returns whether the host **accepted** it. Never whether it
 * arrived: nothing on this path can read a response.
 *
 * `path` is API-relative and leading-slashed, the same shape `api/client.ts`
 * uses (`/judgment/${id}/conclude/`), because `baseUrl` already carries
 * `/api/v1`.
 *
 * No token means no request. An unauthenticated conclude is refused by the
 * server, so sending one would return `true` for something certain to fail —
 * and `true` is what tells the caller it may drop its only copy.
 */
export function deliverOnExit(path: string, body: unknown): boolean {
  const token = getAccessToken();
  if (!token) return false;
  return platform().deliverOnExit({
    url: `${getApiBaseUrl()}${path}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
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
