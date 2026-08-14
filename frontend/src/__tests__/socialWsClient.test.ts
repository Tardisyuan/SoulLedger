/**
 * Tests for lib/ws/social-client.ts — the social realtime channel.
 *
 * Beyond connect/reconnect this client owns two pieces of state that fail
 * silently when wrong: the dedup window (drops events it should have
 * delivered) and the offline queue (loses sends, or grows unbounded). Both
 * are asserted here from the outside, along with the refusal paths: no
 * socket without a token, no reconnect after 4001, no emit for pongs,
 * malformed frames, or frames missing domain/event.
 */
import { SocialWSClient, type SocialEvent } from "@/lib/ws/social-client";

// ── Fake WebSocket ───────────────────────────────────────────────────

type Handler = ((ev: unknown) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  static throwOnConstruct = false;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;

  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;

  constructor(url: string) {
    if (FakeWebSocket.throwOnConstruct) throw new Error("bad url");
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.closeCalls++;
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  receive(raw: unknown) {
    this.onmessage?.({ data: typeof raw === "string" ? raw : JSON.stringify(raw) });
  }

  serverClose(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

function setToken(token: string | null) {
  document.cookie = "soulledger_access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  sessionStorage.clear();
  if (token !== null) document.cookie = `soulledger_access=${token}; path=/`;
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnConstruct = false;
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  setToken("tok-123");
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  jest.useRealTimers();
});

/** Connect, open the socket and complete the server handshake. */
function online(options = {}) {
  const client = new SocialWSClient(options);
  client.connect();
  lastSocket().open();
  lastSocket().receive({ type: "connected" });
  return client;
}

// ── Connection ───────────────────────────────────────────────────────

describe("SocialWSClient connection", () => {
  it("refuses to open a socket without a token", () => {
    setToken(null);
    const client = new SocialWSClient();

    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(client.getStatus()).toBe("disconnected");
  });

  it("stays disconnected when the WebSocket constructor throws", () => {
    FakeWebSocket.throwOnConstruct = true;
    const client = new SocialWSClient();

    expect(() => client.connect()).not.toThrow();
    expect(client.getStatus()).toBe("disconnected");
  });

  it("reaches 'connected' only after the server handshake frame", () => {
    const client = new SocialWSClient();
    client.connect();
    lastSocket().open();
    expect(client.getStatus()).toBe("connecting");

    lastSocket().receive({ type: "connected" });

    expect(client.getStatus()).toBe("connected");
  });

  it("does not open a duplicate socket while one is OPEN", () => {
    const client = online();

    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("reports status transitions through onStatusChange without repeats", () => {
    const onStatusChange = jest.fn();
    const client = new SocialWSClient({ onStatusChange });
    client.connect();
    lastSocket().open();
    lastSocket().receive({ type: "connected" });
    lastSocket().receive({ type: "connected" });

    expect(onStatusChange.mock.calls.map(([s]: [string]) => s)).toEqual(["connecting", "connected"]);
    expect(client.getStatus()).toBe("connected");
  });
});

// ── Event routing & deduplication ────────────────────────────────────

describe("SocialWSClient event routing", () => {
  it("emits a domain event to a matching subscriber", () => {
    const handler = jest.fn();
    const client = online();
    client.subscribe("POST_CREATED", handler);

    lastSocket().receive({ domain: "social", event: "POST_CREATED", post_id: "p1" });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ post_id: "p1" }));
  });

  it("does not deliver an event to a subscriber of a different event type", () => {
    const handler = jest.fn();
    const client = online();
    client.subscribe("POST_DELETED", handler);

    lastSocket().receive({ domain: "social", event: "POST_CREATED" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after the unsubscribe function is called", () => {
    const handler = jest.fn();
    const client = online();
    const unsubscribe = client.subscribe("POST_CREATED", handler);

    unsubscribe();
    lastSocket().receive({ domain: "social", event: "POST_CREATED" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to global handlers registered via onEvent()", () => {
    const global1 = jest.fn();
    const client = online();
    client.onEvent(global1);

    lastSocket().receive({ domain: "social", event: "COMMENT_CREATED" });

    expect(global1).toHaveBeenCalledWith(expect.objectContaining({ event: "COMMENT_CREATED" }));
  });

  it("keeps delivering to remaining handlers when one throws", () => {
    const exploding = jest.fn(() => {
      throw new Error("boom");
    });
    const survivor = jest.fn();
    const specific = jest.fn();
    const client = online();
    client.onEvent(exploding);
    client.onEvent(survivor);
    client.subscribe("POST_CREATED", specific);

    lastSocket().receive({ domain: "social", event: "POST_CREATED" });

    expect(survivor).toHaveBeenCalled();
    expect(specific).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("isolates a throwing event-specific handler from its siblings", () => {
    const exploding = jest.fn(() => {
      throw new Error("boom");
    });
    const survivor = jest.fn();
    const client = online();
    client.subscribe("POST_CREATED", exploding);
    client.subscribe("POST_CREATED", survivor);

    lastSocket().receive({ domain: "social", event: "POST_CREATED" });

    expect(survivor).toHaveBeenCalled();
  });

  it("ignores pong frames rather than emitting them", () => {
    const onEvent = jest.fn();
    online({ onEvent });

    lastSocket().receive({ type: "pong" });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("ignores a frame that has a domain but no event", () => {
    const onEvent = jest.fn();
    online({ onEvent });

    lastSocket().receive({ domain: "social" });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("ignores a malformed frame without throwing", () => {
    const onEvent = jest.fn();
    const client = online({ onEvent });

    expect(() => lastSocket().receive("not-json{")).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
    expect(client.getStatus()).toBe("connected");
  });
});

describe("SocialWSClient deduplication", () => {
  it("delivers an identical event only once inside the dedup window", () => {
    const onEvent = jest.fn();
    online({ onEvent });
    const frame = { domain: "social", event: "REACTION_ADDED", post_id: "p1" };

    lastSocket().receive(frame);
    lastSocket().receive(frame);

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("delivers the same event again once the dedup window has passed", () => {
    const onEvent = jest.fn();
    online({ onEvent });
    const frame = { domain: "social", event: "REACTION_ADDED", post_id: "p1" };

    lastSocket().receive(frame);
    jest.advanceTimersByTime(5001);
    lastSocket().receive(frame);

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("does not conflate two different events of the same type", () => {
    const onEvent = jest.fn();
    online({ onEvent });

    lastSocket().receive({ domain: "social", event: "REACTION_ADDED", post_id: "p1" });
    lastSocket().receive({ domain: "social", event: "REACTION_ADDED", post_id: "p2" });

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("clears the dedup memory on reconnect so replayed events are delivered", () => {
    const onEvent = jest.fn();
    const client = new SocialWSClient({ initialReconnectDelay: 10, onEvent });
    client.connect();
    lastSocket().open();
    lastSocket().receive({ type: "connected" });
    const frame = { domain: "social", event: "POST_CREATED", post_id: "p1" };
    lastSocket().receive(frame);

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(10);
    lastSocket().open(); // onopen resets the deduplicator
    lastSocket().receive({ type: "connected" });
    lastSocket().receive(frame);

    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});

// ── Offline queue ────────────────────────────────────────────────────

describe("SocialWSClient offline queue", () => {
  it("queues a send issued before the socket is OPEN", () => {
    const client = new SocialWSClient();
    client.connect();

    client.send({ type: "hello" });

    expect(client.getOfflineQueueSize()).toBe(1);
    expect(lastSocket().sent).toEqual([]);
  });

  it("flushes the queue over the wire on the connected handshake", () => {
    const client = new SocialWSClient();
    client.connect();
    client.send({ type: "a" });
    client.send({ type: "b" });

    lastSocket().open();
    lastSocket().receive({ type: "connected" });

    expect(lastSocket().sent).toEqual(['{"type":"a"}', '{"type":"b"}']);
    expect(client.getOfflineQueueSize()).toBe(0);
  });

  it("sends straight through without queueing once OPEN", () => {
    const client = online();

    client.send({ type: "live" });

    expect(lastSocket().sent).toContain('{"type":"live"}');
    expect(client.getOfflineQueueSize()).toBe(0);
  });

  it("drops the oldest message instead of growing past offlineQueueSize", () => {
    const client = new SocialWSClient({ offlineQueueSize: 2 });
    client.connect();

    client.send({ type: "1" });
    client.send({ type: "2" });
    client.send({ type: "3" });

    expect(client.getOfflineQueueSize()).toBe(2);
    lastSocket().open();
    lastSocket().receive({ type: "connected" });
    expect(lastSocket().sent).toEqual(['{"type":"2"}', '{"type":"3"}']);
  });
});

// ── Reconnection & teardown ──────────────────────────────────────────

describe("SocialWSClient reconnection", () => {
  it("reconnects after an unexpected close using exponential backoff", () => {
    const client = new SocialWSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(1006);
    expect(client.getStatus()).toBe("reconnecting");

    jest.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(1999); // second attempt waits 2000ms
    expect(FakeWebSocket.instances).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("clamps the backoff at maxReconnectDelay", () => {
    const client = new SocialWSClient({ initialReconnectDelay: 1000, maxReconnectDelay: 1500 });
    client.connect();

    for (let i = 0; i < 5; i++) {
      lastSocket().serverClose(1006);
      jest.advanceTimersByTime(1500);
    }

    // Unclamped, the 5th delay would be 16000ms and no socket would exist yet.
    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it("refuses to reconnect after a 4001 auth close", () => {
    const client = new SocialWSClient({ initialReconnectDelay: 10 });
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(4001);

    expect(client.getStatus()).toBe("disconnected");
    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("stops retrying once maxReconnectAttempts is exhausted", () => {
    const client = new SocialWSClient({ initialReconnectDelay: 10, maxReconnectAttempts: 1 });
    client.connect();

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(10);
    expect(FakeWebSocket.instances).toHaveLength(2);

    lastSocket().serverClose(1006);
    expect(client.getStatus()).toBe("disconnected");
    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("disconnect() cancels a pending reconnect and blocks later connects", () => {
    const client = new SocialWSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().serverClose(1006);

    client.disconnect();
    jest.advanceTimersByTime(60_000);
    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe("disconnected");
  });

  it("disconnect() closes the live socket", () => {
    const client = online();
    const socket = lastSocket();

    client.disconnect();

    expect(socket.closeCalls).toBe(1);
  });
});

describe("SocialWSClient heartbeat", () => {
  it("emits heartbeats on the configured interval while OPEN", () => {
    const client = new SocialWSClient({ heartbeatInterval: 1000 });
    client.connect();
    lastSocket().open();

    jest.advanceTimersByTime(3000);

    expect(lastSocket().sent.filter((m: string) => m.includes("heartbeat"))).toHaveLength(3);
    expect(client.getStatus()).toBe("connecting");
  });

  it("skips the heartbeat when the socket is no longer OPEN", () => {
    const client = new SocialWSClient({ heartbeatInterval: 1000 });
    client.connect();
    const socket = lastSocket();
    socket.open();
    socket.readyState = FakeWebSocket.CLOSING;

    jest.advanceTimersByTime(3000);

    expect(socket.sent).toEqual([]);
  });

  it("stops heartbeating after the socket closes", () => {
    const client = new SocialWSClient({ heartbeatInterval: 1000, initialReconnectDelay: 999_999 });
    client.connect();
    const socket = lastSocket();
    socket.open();
    jest.advanceTimersByTime(1000);
    const before = socket.sent.length;

    socket.serverClose(1006);
    socket.readyState = FakeWebSocket.OPEN; // even if the socket looked writable again
    jest.advanceTimersByTime(10_000);

    expect(socket.sent).toHaveLength(before);
  });
});

// ── Type surface ─────────────────────────────────────────────────────

describe("SocialWSClient typing", () => {
  it("hands subscribers a payload keeping its extra fields", () => {
    let received: SocialEvent | null = null;
    const client = online();
    client.subscribe("USER_FOLLOWED", (e) => {
      received = e;
    });

    lastSocket().receive({ domain: "social", event: "USER_FOLLOWED", follower_id: "u9" });

    expect(received).not.toBeNull();
    expect((received as unknown as { follower_id: string }).follower_id).toBe("u9");
  });
});
