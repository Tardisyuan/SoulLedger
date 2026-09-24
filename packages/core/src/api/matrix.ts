/**
 * The soul app's Matrix client: the five client-server calls the chat needs
 * (login, sync, send, messages, read receipt) and a pure reducer over what
 * they return. Nothing else.
 *
 * WHY HAND-WRITTEN AND NOT matrix-js-sdk. The app never creates a room, never
 * invites, never changes state — the Synapse module
 * (`config/synapse/soulledger_policy.py`) refuses all of that to everyone but
 * the backend's service account anyway. What is left is "read the timeline of
 * rooms I was put in, and post text into them". The SDK brings E2EE, a crypto
 * WASM, IndexedDB stores and a room model for the other ninety percent of
 * Matrix, and would be the largest dependency in the app for the smallest
 * feature. Five endpoints over the axios this package already ships is less
 * code than the SDK's setup.
 *
 * WHY axios AND NOT fetch. `fetch` is not on this package's host allowlist
 * (`src/platform/host-globals.d.ts`), and adding it is a claim about every
 * client; axios is already a dependency, runs on React Native, and is what the
 * two soul clients beside this one use. `matrixHttp` is its own instance: the
 * Matrix server is a different origin with a different token, and none of
 * `soulHttp`'s interceptors (refresh, password gate) apply to it.
 *
 * WHAT THE SERVER DECIDES. Whether a soul may speak in a room is Synapse's
 * power levels plus the policy module, set by the backend. This client never
 * predicts it: a refused send comes back as a `MatrixRequestError` carrying
 * Synapse's `errcode` (`M_FORBIDDEN` for "user_level (0) < send_level (50)"
 * and for the module's refusals alike), and the app asks the backend why.
 */
import axios, { type AxiosError } from "axios";

/** What `GET /me/chat/session/` hands out: a short-lived login token for this soul's Matrix user. */
export interface MatrixSessionGrant {
  homeserver: string;
  login_type: string;
  token: string;
}

export interface MatrixCredentials {
  baseUrl: string;
  userId: string;
  accessToken: string;
  /** The Matrix device this login landed on. Pass it to the next login to stay on it. */
  deviceId: string | null;
}

/** A refusal from Synapse (`errcode` = `M_*`), or no answer at all (`errcode` = "", `status` = null). */
export class MatrixRequestError extends Error {
  constructor(
    message: string,
    readonly errcode: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "MatrixRequestError";
  }
}

/** No response reached us: offline, DNS, timeout, or Synapse down. The one case worth queueing for. */
export const isUnreachable = (e: unknown) => e instanceof MatrixRequestError && e.status === null;

export const matrixHttp = axios.create({ headers: { "Content-Type": "application/json" } });

const trim = (url: string) => url.replace(/\/+$/, "");
const room = (roomId: string) => encodeURIComponent(roomId);

function asMatrixError(error: unknown): MatrixRequestError {
  if (error instanceof MatrixRequestError) return error;
  if (!axios.isAxiosError(error)) return new MatrixRequestError(String(error), "", null);
  const response = (error as AxiosError<{ errcode?: unknown; error?: unknown }>).response;
  if (!response) return new MatrixRequestError(error.message, "", null);
  const errcode = typeof response.data?.errcode === "string" ? response.data.errcode : "";
  const message = typeof response.data?.error === "string" ? response.data.error : `HTTP ${response.status}`;
  return new MatrixRequestError(message, errcode, response.status);
}

async function call<T>(
  method: "GET" | "POST" | "PUT",
  url: string,
  options: { token?: string; params?: Record<string, string | number>; data?: unknown; timeout?: number } = {}
): Promise<T> {
  try {
    const response = await matrixHttp.request<T>({
      method,
      url,
      params: options.params,
      data: options.data,
      timeout: options.timeout,
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
    });
    return response.data;
  } catch (error) {
    throw asMatrixError(error);
  }
}

/**
 * Trade the backend's one-time login token for a Matrix access token.
 *
 * `deviceId`: log in AS that device again instead of minting a new one. Synapse
 * de-duplicates `PUT send/{txnId}` per (user, device) — MSC3970 — so a retry
 * after a fresh login is de-duplicated only if it comes from the same device.
 */
export async function matrixLogin(grant: MatrixSessionGrant, deviceId?: string | null): Promise<MatrixCredentials> {
  const baseUrl = trim(grant.homeserver);
  const data = await call<{ access_token: string; user_id: string; device_id?: string }>("POST", `${baseUrl}/_matrix/client/v3/login`, {
    data: {
      type: grant.login_type,
      token: grant.token,
      initial_device_display_name: "SoulLedger",
      ...(deviceId ? { device_id: deviceId } : {}),
    },
  });
  return { baseUrl, userId: data.user_id, accessToken: data.access_token, deviceId: data.device_id ?? null };
}

/** Timeline: text messages only. Ephemeral: read receipts only. No presence, no account data. */
export const SYNC_FILTER = JSON.stringify({
  presence: { types: [] },
  account_data: { types: [] },
  room: {
    timeline: { limit: 30, types: ["m.room.message"] },
    state: { types: [] },
    ephemeral: { types: ["m.receipt"] },
    account_data: { types: [] },
  },
});

export interface MatrixEvent {
  event_id: string;
  type: string;
  sender: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  unsigned?: { transaction_id?: string };
}

export interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<
      string,
      {
        timeline?: { events?: MatrixEvent[]; prev_batch?: string; limited?: boolean };
        ephemeral?: { events?: { type: string; content: Record<string, Record<string, Record<string, unknown>>> }[] };
        unread_notifications?: { notification_count?: number };
      }
    >;
  };
}

export function matrixClient(creds: MatrixCredentials) {
  const base = `${creds.baseUrl}/_matrix/client/v3`;
  const token = creds.accessToken;
  return {
    userId: creds.userId,
    /** Long-poll. `timeoutMs` 0 answers at once (the first sync); the HTTP timeout is set above it. */
    sync: (since: string | null, timeoutMs: number) =>
      call<SyncResponse>("GET", `${base}/sync`, {
        token,
        params: { filter: SYNC_FILTER, timeout: timeoutMs, ...(since ? { since } : {}) },
        timeout: timeoutMs + 15_000,
      }),
    /** Idempotent per `txnId`: a retry after a lost response does not post twice (Matrix spec). */
    send: (roomId: string, txnId: string, body: string) =>
      call<{ event_id: string }>("PUT", `${base}/rooms/${room(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`, {
        token,
        data: { msgtype: "m.text", body },
      }).then((r) => r.event_id),
    /** Older history, newest first. `from` is a `prev_batch` / `end` token; omitted = from the live end. */
    messages: (roomId: string, from: string | null, limit = 30) =>
      call<{ chunk: MatrixEvent[]; end?: string }>("GET", `${base}/rooms/${room(roomId)}/messages`, {
        token,
        params: { dir: "b", limit, filter: JSON.stringify({ types: ["m.room.message"] }), ...(from ? { from } : {}) },
      }),
    readReceipt: (roomId: string, eventId: string) =>
      call<object>("POST", `${base}/rooms/${room(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`, {
        token,
        data: {},
      }).then(() => undefined),
  };
}

export type MatrixClient = ReturnType<typeof matrixClient>;

// ── state ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  eventId: string;
  sender: string;
  body: string;
  ts: number;
  /** The officer's name on a hall reply (`io.soulledger.officer`, set by the backend); `null` otherwise. */
  officer: string | null;
  /** That officer's position (`io.soulledger.officer_title`, e.g. 判官); `null` when not given or not a hall reply. */
  officerTitle: string | null;
  /** Set on this device's own sends: matches a queued message to its echo. */
  txnId: string | null;
}

export interface RoomTimeline {
  /** Oldest first, no duplicates. */
  messages: ChatMessage[];
  unread: number;
  /** userId → the event that user has read up to. */
  readUpTo: Record<string, string>;
  /** Where `/messages` continues backwards from; `null` once the start of the room is loaded. */
  prevBatch: string | null;
}

export interface TimelineState {
  since: string | null;
  rooms: Record<string, RoomTimeline>;
}

export const EMPTY_TIMELINE: TimelineState = { since: null, rooms: {} };
const EMPTY_ROOM: RoomTimeline = { messages: [], unread: 0, readUpTo: {}, prevBatch: null };

/** A text message event → a message; anything else (edits, redactions, other types) → null. */
export function toMessage(event: MatrixEvent): ChatMessage | null {
  if (event.type !== "m.room.message" || typeof event.content?.body !== "string") return null;
  const officer = event.content["io.soulledger.officer"];
  const officerTitle = event.content["io.soulledger.officer_title"];
  return {
    eventId: event.event_id,
    sender: event.sender,
    body: event.content.body,
    ts: event.origin_server_ts,
    officer: typeof officer === "string" && officer ? officer : null,
    officerTitle: typeof officerTitle === "string" && officerTitle ? officerTitle : null,
    txnId: event.unsigned?.transaction_id ?? null,
  };
}

function merge(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.eventId, m]));
  for (const m of incoming) byId.set(m.eventId, { ...byId.get(m.eventId), ...m });
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/** Fold one `/sync` answer into the state. Pure. */
export function applySync(state: TimelineState, response: SyncResponse): TimelineState {
  const rooms = { ...state.rooms };
  for (const [roomId, update] of Object.entries(response.rooms?.join ?? {})) {
    const current = rooms[roomId] ?? EMPTY_ROOM;
    const incoming = (update.timeline?.events ?? []).map(toMessage).filter((m): m is ChatMessage => m !== null);
    const readUpTo = { ...current.readUpTo };
    for (const ephemeral of update.ephemeral?.events ?? []) {
      if (ephemeral.type !== "m.receipt") continue;
      for (const [eventId, receipts] of Object.entries(ephemeral.content)) {
        for (const userId of Object.keys(receipts["m.read"] ?? {})) readUpTo[userId] = eventId;
      }
    }
    rooms[roomId] = {
      // A `limited` timeline has a gap before it: what was loaded before is no longer contiguous.
      messages: update.timeline?.limited ? merge([], incoming) : merge(current.messages, incoming),
      unread: update.unread_notifications?.notification_count ?? current.unread,
      readUpTo,
      // A room seen for the first time, or after a gap: history continues from this page's start.
      prevBatch:
        !(roomId in state.rooms) || update.timeline?.limited ? (update.timeline?.prev_batch ?? null) : current.prevBatch,
    };
  }
  return { since: response.next_batch, rooms };
}

/** Fold a backwards `/messages` page in. `end` absent = the start of the room was reached. */
export function applyHistory(state: TimelineState, roomId: string, chunk: MatrixEvent[], end: string | undefined): TimelineState {
  const current = state.rooms[roomId] ?? EMPTY_ROOM;
  const older = chunk.map(toMessage).filter((m): m is ChatMessage => m !== null);
  return {
    ...state,
    rooms: { ...state.rooms, [roomId]: { ...current, messages: merge(current.messages, older), prevBatch: end ?? null } },
  };
}

/**
 * Whether `userId` has read `message`: their receipt points at this message or a
 * later one. A receipt on an event not loaded here says nothing either way — false.
 */
export function hasRead(timeline: RoomTimeline | undefined, userId: string, message: ChatMessage): boolean {
  const upTo = timeline?.readUpTo[userId];
  if (!upTo) return false;
  const marker = timeline.messages.find((m) => m.eventId === upTo);
  return !!marker && marker.ts >= message.ts;
}
