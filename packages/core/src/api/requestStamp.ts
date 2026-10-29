/**
 * Request headers every client stamps (`client.ts` `api`, `soul.ts` `soulHttp`). Its own module, not `client.ts`:
 * tests that replace `client.ts` with a stub would otherwise take these functions away from `soulHttp` too.
 */
/** 32 hex chars. Not `crypto.randomUUID`: React Native's Hermes has no `crypto`, and this id only has to be unique enough to find a request in the logs. */
export function newRequestId(): string {
  let id = "";
  for (let i = 0; i < 32; i += 1) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

type HeaderBag = { [name: string]: unknown };

/**
 * Two headers on every request, each set only when the caller did not (2026-10-29):
 *
 * - `X-Request-ID` (`backend/apps/core/trace.py`): the server logs it on every line, writes it on the audit rows
 *   of the request and sends it back. A short form of it goes into error details (`requestIdOf`).
 * - `Idempotency-Key` on writes (`backend/apps/core/idempotency.py`): the key endpoints answer a repeat with the
 *   first response instead of doing the work twice. A retry of the same config -- the 401 refresh in client.ts replays
 *   `error.config` -- carries the same key, because it is already set. An outbox that replays after a restart
 *   passes its own persisted key (`soulInboxApi.reply`, `soulChatApi.send`).
 */
export function stampRequest(headers: HeaderBag, method: string | undefined): void {
  if (!headers["X-Request-ID"]) headers["X-Request-ID"] = newRequestId();
  const write = !["get", "head", "options"].includes((method ?? "get").toLowerCase());
  if (write && !headers["Idempotency-Key"]) headers["Idempotency-Key"] = newRequestId();
}

/** The first 8 characters of the request id of a failed call, for an error detail line; `null` when there is none. */
export function requestIdOf(error: unknown): string | null {
  const e = error as { response?: { headers?: HeaderBag }; config?: { headers?: HeaderBag } } | null;
  const id = e?.response?.headers?.["x-request-id"] ?? e?.config?.headers?.["X-Request-ID"];
  return typeof id === "string" && id ? id.slice(0, 8) : null;
}
