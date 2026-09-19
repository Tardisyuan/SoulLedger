/**
 * The hand-written Matrix client against a double that answers the way Synapse
 * v1.161 does — the refusals included, because a double that accepts what
 * Synapse refuses reproduces the bug instead of catching it (the backend's
 * `tests/chat_support.py` records the time that happened). Each behaviour below
 * is the one `backend/tests/test_chat_synapse_integration.py` pins against a
 * real Synapse:
 *
 *   - sending needs power level ≥ 50: `403 M_FORBIDDEN "user_level (0) < send_level (50)"`;
 *   - the policy module refuses the initiator of a throttled room without a grant:
 *     `403 M_FORBIDDEN "This message has been rejected as probable spam"`;
 *   - a bad or expired access token is `401 M_UNKNOWN_TOKEN`;
 *   - `PUT .../send/{txnId}` is idempotent per (token, txnId): a retry returns the
 *     first event id and posts nothing (client-server spec, "Transaction identifiers");
 *   - `unsigned.transaction_id` is echoed only to the client that sent it.
 */
import { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_TIMELINE,
  MatrixRequestError,
  applyHistory,
  applySync,
  hasRead,
  isUnreachable,
  matrixClient,
  matrixHttp,
  matrixLogin,
  type MatrixEvent,
} from "../matrix";

const HS = "http://hs.test";
const ROOM = "!r0:hs.test";
const ME = "@me:hs.test";
const PEER = "@peer:hs.test";

type Reply = { status: number; data: unknown } | "offline";

class FakeSynapse {
  tokens = new Map<string, string>(); // access token → user
  levels: Record<string, number> = { [ME]: 50, [PEER]: 50 };
  throttledInitiator: string | null = null;
  events: MatrixEvent[] = [];
  txns = new Map<string, string>(); // token|txn → event id
  calls: { method: string; url: string; params: unknown; body: unknown; auth: unknown }[] = [];

  handle(config: InternalAxiosRequestConfig): Reply {
    const url = (config.url ?? "").replace(HS, "");
    const method = (config.method ?? "get").toUpperCase();
    const body = config.data ? JSON.parse(config.data as string) : undefined;
    const auth = config.headers?.Authorization as string | undefined;
    this.calls.push({ method, url, params: config.params, body, auth });
    if (method === "POST" && url === "/_matrix/client/v3/login") {
      if (body.type !== "org.matrix.login.jwt" || body.token !== "jwt-for-me") {
        return { status: 403, data: { errcode: "M_FORBIDDEN", error: "JWT validation failed" } };
      }
      this.tokens.set("tok-me", ME);
      return { status: 200, data: { access_token: "tok-me", user_id: ME, device_id: "D1" } };
    }
    const user = this.tokens.get((auth ?? "").replace(/^Bearer /, ""));
    if (!user) return { status: 401, data: { errcode: "M_UNKNOWN_TOKEN", error: "Invalid access token passed." } };
    const send = url.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/);
    if (method === "PUT" && send) {
      const key = `${auth}|${decodeURIComponent(send[2])}`;
      const known = this.txns.get(key);
      if (known) return { status: 200, data: { event_id: known } };
      const level = this.levels[user] ?? 0;
      if (level < 50) return { status: 403, data: { errcode: "M_FORBIDDEN", error: `user_level (${level}) < send_level (50)` } };
      if (this.throttledInitiator === user) {
        return { status: 403, data: { errcode: "M_FORBIDDEN", error: "This message has been rejected as probable spam" } };
      }
      const event = this.post(decodeURIComponent(send[1]), user, body.body, decodeURIComponent(send[2]));
      this.txns.set(key, event.event_id);
      return { status: 200, data: { event_id: event.event_id } };
    }
    if (method === "GET" && url === "/_matrix/client/v3/sync") {
      const events = this.events.map((e) =>
        // Synapse echoes transaction_id only to the sender's own client.
        e.sender === user ? e : { ...e, unsigned: {} }
      );
      return { status: 200, data: { next_batch: `s${this.events.length}`, rooms: { join: { [ROOM]: { timeline: { events, prev_batch: "p0" } } } } } };
    }
    if (method === "GET" && url.startsWith("/_matrix/client/v3/rooms/")) {
      return { status: 200, data: { chunk: [...this.events].reverse(), start: "p0" } };
    }
    if (method === "POST" && url.includes("/receipt/m.read/")) return { status: 200, data: {} };
    return { status: 404, data: { errcode: "M_UNRECOGNIZED", error: "Unrecognized request" } };
  }

  post(roomId: string, sender: string, body: string, txn?: string): MatrixEvent {
    const event: MatrixEvent = {
      event_id: `$e${this.events.length}`,
      type: "m.room.message",
      sender,
      origin_server_ts: 1000 + this.events.length,
      content: { msgtype: "m.text", body },
      unsigned: txn ? { transaction_id: txn } : {},
    };
    if (roomId === ROOM) this.events.push(event);
    return event;
  }
}

let synapse: FakeSynapse;
let offline = false;
const last = () => synapse.calls[synapse.calls.length - 1];

beforeEach(() => {
  synapse = new FakeSynapse();
  offline = false;
  matrixHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const reply = offline ? "offline" : synapse.handle(config);
    const { AxiosError } = await import("axios");
    if (reply === "offline") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    const response = { status: reply.status, data: reply.data, headers: {}, config, statusText: "" } as AxiosResponse;
    if (reply.status >= 400) throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, null, response);
    return response;
  };
});

async function signedIn() {
  return matrixClient(await matrixLogin({ homeserver: `${HS}/`, login_type: "org.matrix.login.jwt", token: "jwt-for-me" }));
}

describe("login", () => {
  it("trades the backend's JWT for an access token, at the homeserver without its trailing slash", async () => {
    const client = await signedIn();
    expect(client.userId).toBe(ME);
    expect(synapse.calls[0]).toMatchObject({ method: "POST", url: "/_matrix/client/v3/login", auth: undefined });
    expect(synapse.calls[0].body).toMatchObject({ type: "org.matrix.login.jwt", token: "jwt-for-me" });
  });

  it("a refused token surfaces Synapse's errcode", async () => {
    const error = await matrixLogin({ homeserver: HS, login_type: "org.matrix.login.jwt", token: "stale" }).catch((e) => e);
    expect(error).toBeInstanceOf(MatrixRequestError);
    expect(error).toMatchObject({ errcode: "M_FORBIDDEN", status: 403 });
  });
});

describe("send", () => {
  it("PUTs text into the room with the token, room id and txn id path-encoded", async () => {
    const client = await signedIn();
    const id = await client.send(ROOM, "t/1", "你好");
    expect(id).toBe("$e0");
    expect(last()).toMatchObject({
      method: "PUT",
      url: "/_matrix/client/v3/rooms/!r0%3Ahs.test/send/m.room.message/t%2F1",
      auth: "Bearer tok-me",
      body: { msgtype: "m.text", body: "你好" },
    });
  });

  it("a retry with the same txn id does not post twice — what makes queued resends safe", async () => {
    const client = await signedIn();
    const first = await client.send(ROOM, "t1", "一次");
    const again = await client.send(ROOM, "t1", "一次");
    expect(again).toBe(first);
    expect(synapse.events.map((e) => e.content.body)).toEqual(["一次"]);
  });

  it("power level 0 (throttled initiator, or muted) is Synapse's 403, carried with its errcode", async () => {
    const client = await signedIn();
    synapse.levels[ME] = 0;
    const error = await client.send(ROOM, "t1", "绕过后端").catch((e) => e);
    expect(error).toMatchObject({ errcode: "M_FORBIDDEN", status: 403, message: "user_level (0) < send_level (50)" });
    expect(isUnreachable(error)).toBe(false);
    expect(synapse.events).toEqual([]);
  });

  it("the policy module's refusal in a raise window is the same 403 shape", async () => {
    const client = await signedIn();
    synapse.throttledInitiator = ME;
    const error = await client.send(ROOM, "t1", "窗口里裸发").catch((e) => e);
    expect(error).toMatchObject({ errcode: "M_FORBIDDEN", status: 403 });
  });

  it("no answer at all is `unreachable` (status null) — the only case the app queues for", async () => {
    const client = await signedIn();
    offline = true;
    const error = await client.send(ROOM, "t1", "排队").catch((e) => e);
    expect(error).toMatchObject({ errcode: "", status: null });
    expect(isUnreachable(error)).toBe(true);
  });

  it("an expired access token is 401 M_UNKNOWN_TOKEN", async () => {
    const client = await signedIn();
    synapse.tokens.clear();
    const error = await client.send(ROOM, "t1", "x").catch((e) => e);
    expect(error).toMatchObject({ errcode: "M_UNKNOWN_TOKEN", status: 401 });
  });
});

describe("timeline", () => {
  it("sync folds text messages in order, and our own echo carries its txn id", async () => {
    const client = await signedIn();
    synapse.post(ROOM, PEER, "来了");
    await client.send(ROOM, "mine-1", "回你");
    const state = applySync(EMPTY_TIMELINE, await client.sync(null, 0));
    expect(state.rooms[ROOM].messages.map((m) => [m.sender, m.body, m.txnId])).toEqual([
      [PEER, "来了", null],
      [ME, "回你", "mine-1"],
    ]);
    expect(state.since).toBe("s2");
    expect(state.rooms[ROOM].prevBatch).toBe("p0");
    expect(last().params).toMatchObject({ timeout: 0 });
  });

  it("a second sync with the same events does not duplicate them", async () => {
    const client = await signedIn();
    synapse.post(ROOM, PEER, "一");
    const once = applySync(EMPTY_TIMELINE, await client.sync(null, 0));
    const twice = applySync(once, await client.sync(once.since, 0));
    expect(twice.rooms[ROOM].messages).toHaveLength(1);
    expect(last().params).toMatchObject({ since: "s1" });
  });

  it("ignores non-text events and keeps the officer's name from a hall reply", () => {
    const state = applySync(EMPTY_TIMELINE, {
      next_batch: "s1",
      rooms: {
        join: {
          [ROOM]: {
            timeline: {
              events: [
                { event_id: "$a", type: "m.room.message", sender: "@svc:hs", origin_server_ts: 1, content: { body: "已收", "io.soulledger.officer": "崔珏" } },
                { event_id: "$b", type: "m.room.message", sender: PEER, origin_server_ts: 2, content: { msgtype: "m.image" } },
                { event_id: "$c", type: "m.reaction", sender: PEER, origin_server_ts: 3, content: { body: "x" } },
              ],
            },
          },
        },
      },
    });
    expect(state.rooms[ROOM].messages.map((m) => [m.eventId, m.officer])).toEqual([["$a", "崔珏"]]);
  });

  it("history pages merge behind what sync loaded, and the room's start ends paging", () => {
    const synced = applySync(EMPTY_TIMELINE, {
      next_batch: "s1",
      rooms: { join: { [ROOM]: { timeline: { events: [event("$3", 3)], prev_batch: "p1", limited: true } } } },
    });
    const paged = applyHistory(synced, ROOM, [event("$2", 2), event("$1", 1)], undefined);
    expect(paged.rooms[ROOM].messages.map((m) => m.eventId)).toEqual(["$1", "$2", "$3"]);
    expect(paged.rooms[ROOM].prevBatch).toBeNull();
  });

  it("read receipts: read up to a later event means read; a receipt on an unloaded event means nothing", () => {
    const state = applySync(EMPTY_TIMELINE, {
      next_batch: "s1",
      rooms: {
        join: {
          [ROOM]: {
            timeline: { events: [event("$1", 1, ME), event("$2", 2, PEER)] },
            ephemeral: { events: [{ type: "m.receipt", content: { $2: { "m.read": { [PEER]: { ts: 5 } } } } }] },
            unread_notifications: { notification_count: 1 },
          },
        },
      },
    });
    const room = state.rooms[ROOM];
    expect(room.unread).toBe(1);
    expect(hasRead(room, PEER, room.messages[0])).toBe(true);
    expect(hasRead(room, ME, room.messages[0])).toBe(false);
    const elsewhere = { ...room, readUpTo: { [PEER]: "$not-loaded" } };
    expect(hasRead(elsewhere, PEER, room.messages[0])).toBe(false);
  });
});

function event(id: string, ts: number, sender = PEER): MatrixEvent {
  return { event_id: id, type: "m.room.message", sender, origin_server_ts: ts, content: { msgtype: "m.text", body: id } };
}
