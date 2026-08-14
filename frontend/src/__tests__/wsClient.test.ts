/**
 * Tests for lib/ws/client.ts — the notification WebSocket state machine.
 *
 * This client is the whole realtime channel: if it silently stops
 * reconnecting, or swallows a message type, every toast/notification in the
 * app goes quiet with no error anywhere. The tests below therefore assert
 * *refusals* as much as successes — no socket without a token, no reconnect
 * after a 4001 auth close, no generic-event dispatch for a payload missing
 * domain/event, no send() on a socket that is not OPEN.
 */
import { WSClient, type WSStatus } from "@/lib/ws/client";

// ── Fake WebSocket ───────────────────────────────────────────────────

type Handler = ((ev: unknown) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  /** When set, the constructor throws — simulates a malformed URL. */
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

  // ── Test drivers ───────────────────────────────────────────────────

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

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnConstruct = false;
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  setToken("tok-123");
  // The client warns on server errors and heartbeat timeouts by design;
  // spying keeps the assertions explicit and the test output clean.
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// ── Auth gate ────────────────────────────────────────────────────────

describe("WSClient authentication gate", () => {
  it("refuses to open a socket when no token is available", () => {
    setToken(null);
    const client = new WSClient();

    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(client.getStatus()).toBe("disconnected");
  });

  it("does not report 'connecting' when unauthenticated", () => {
    setToken(null);
    const onStatusChange = jest.fn();
    new WSClient({ onStatusChange }).connect();

    expect(onStatusChange).not.toHaveBeenCalledWith("connecting");
  });

  it("falls back to sessionStorage when the cookie is absent", () => {
    setToken(null);
    sessionStorage.setItem("soulledger_access", "session-tok");

    new WSClient().connect();

    expect(lastSocket().url).toContain("token=session-tok");
  });

  it("prefers the cookie token over the sessionStorage one", () => {
    setToken("cookie-tok");
    sessionStorage.setItem("soulledger_access", "session-tok");

    new WSClient().connect();

    expect(lastSocket().url).toContain("token=cookie-tok");
    expect(lastSocket().url).not.toContain("session-tok");
  });

  it("percent-encodes the token into the query string", () => {
    setToken("a b+c/d");
    new WSClient().connect();

    expect(lastSocket().url).toContain(`token=${encodeURIComponent("a b+c/d")}`);
  });

  it("derives a ws:// URL from the http API base", () => {
    new WSClient().connect();

    expect(lastSocket().url.startsWith("ws://localhost:8000/ws/notifications/?token=")).toBe(true);
  });

  it("stays disconnected when the WebSocket constructor throws", () => {
    FakeWebSocket.throwOnConstruct = true;
    const client = new WSClient();

    expect(() => client.connect()).not.toThrow();
    expect(client.getStatus()).toBe("disconnected");
  });

  it("does not open a second socket while one is already OPEN", () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();

    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("does not open a second socket while one is still CONNECTING", () => {
    const client = new WSClient();
    client.connect();
    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

// ── Message routing ──────────────────────────────────────────────────

describe("WSClient message routing", () => {
  function connected(options = {}) {
    const client = new WSClient(options);
    client.connect();
    lastSocket().open();
    return client;
  }

  it("only reports 'connected' after the server's connected frame, not on socket open", () => {
    const client = connected();
    expect(client.getStatus()).toBe("connecting");

    lastSocket().receive({ type: "connected", user_id: 1, tenant_code: "CN", permissions: [] });

    expect(client.getStatus()).toBe("connected");
  });

  it("hands the connected frame to onConnected", () => {
    const onConnected = jest.fn();
    connected({ onConnected });

    lastSocket().receive({ type: "connected", user_id: 7, tenant_code: "EG", permissions: ["a"] });

    expect(onConnected).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, tenant_code: "EG", permissions: ["a"] }),
    );
  });

  it("routes a notification frame to onNotification with the inner payload", () => {
    const onNotification = jest.fn();
    connected({ onNotification });

    lastSocket().receive({ type: "notification", notification: { id: 3, title: "Hi" } });

    expect(onNotification).toHaveBeenCalledWith({ id: 3, title: "Hi" });
  });

  it("routes a workflow frame to onWorkflowEvent with the whole frame", () => {
    const onWorkflowEvent = jest.fn();
    connected({ onWorkflowEvent });

    lastSocket().receive({ type: "workflow", event: "WORKFLOW_APPROVED", workflow_id: "w1" });

    expect(onWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "WORKFLOW_APPROVED", workflow_id: "w1" }),
    );
  });

  it("routes an unrecognised type carrying domain+event to onGenericEvent", () => {
    const onGenericEvent = jest.fn();
    connected({ onGenericEvent });

    lastSocket().receive({ type: "broadcast", domain: "social", event: "POST_CREATED" });

    expect(onGenericEvent).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "social", event: "POST_CREATED" }),
    );
  });

  it("drops an unrecognised frame that has no domain/event rather than dispatching it", () => {
    const onGenericEvent = jest.fn();
    connected({ onGenericEvent });

    lastSocket().receive({ type: "mystery", payload: 1 });

    expect(onGenericEvent).not.toHaveBeenCalled();
  });

  it("drops an unrecognised frame that has a domain but no event", () => {
    const onGenericEvent = jest.fn();
    connected({ onGenericEvent });

    lastSocket().receive({ type: "mystery", domain: "social" });

    expect(onGenericEvent).not.toHaveBeenCalled();
  });

  it("warns instead of dispatching when the server sends an error frame", () => {
    const onGenericEvent = jest.fn();
    connected({ onGenericEvent });

    lastSocket().receive({ type: "error", message: "permission denied" });

    expect(warnSpy).toHaveBeenCalledWith("[WS] Server error:", "permission denied");
    expect(onGenericEvent).not.toHaveBeenCalled();
  });

  it("passes every parsed frame to onMessage before routing", () => {
    const onMessage = jest.fn();
    connected({ onMessage });

    lastSocket().receive({ type: "pong" });
    lastSocket().receive({ type: "notification", notification: {} });

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenNthCalledWith(1, { type: "pong" });
  });

  it("survives a malformed (non-JSON) frame without throwing or dispatching", () => {
    const onMessage = jest.fn();
    const onGenericEvent = jest.fn();
    const client = connected({ onMessage, onGenericEvent });
    lastSocket().receive({ type: "connected" });
    onMessage.mockClear();

    expect(() => lastSocket().receive("}{ not json")).not.toThrow();

    // Parsing failed, so nothing at all is handed downstream.
    expect(onMessage).not.toHaveBeenCalled();
    expect(onGenericEvent).not.toHaveBeenCalled();
    // A garbage frame must not knock the client out of the connected state.
    expect(client.getStatus()).toBe("connected");
  });

  it("keeps routing normal frames after a malformed one", () => {
    const onNotification = jest.fn();
    connected({ onNotification });

    lastSocket().receive("<<garbage>>");
    lastSocket().receive({ type: "notification", notification: { id: 9 } });

    expect(onNotification).toHaveBeenCalledWith({ id: 9 });
  });

  it("does not re-fire onStatusChange for a repeated connected frame", () => {
    const onStatusChange = jest.fn();
    connected({ onStatusChange });

    lastSocket().receive({ type: "connected" });
    lastSocket().receive({ type: "connected" });

    expect(onStatusChange.mock.calls.filter(([s]: [WSStatus]) => s === "connected")).toHaveLength(1);
  });
});

// ── Reconnection ─────────────────────────────────────────────────────

describe("WSClient reconnection", () => {
  beforeEach(() => {
    // Jitter is base * (0.5 + random*0.5); pinning random makes the delay exact.
    jest.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    (Math.random as jest.Mock).mockRestore?.();
  });

  it("schedules a reconnect after an unexpected close", () => {
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(1006);
    expect(client.getStatus()).toBe("reconnecting");

    jest.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not reconnect before the backoff delay elapses", () => {
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().serverClose(1006);

    jest.advanceTimersByTime(499);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("backs off exponentially across successive failures", () => {
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(500); // attempt 0 -> 1000 * 2^0 * 0.5
    expect(FakeWebSocket.instances).toHaveLength(2);

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(999); // attempt 1 -> 1000 * 2^1 * 0.5 = 1000
    expect(FakeWebSocket.instances).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    expect(client.getStatus()).toBe("connecting");
  });

  it("clamps the backoff to maxReconnectDelay", () => {
    const client = new WSClient({ initialReconnectDelay: 1000, maxReconnectDelay: 2000 });
    client.connect();

    for (let i = 0; i < 6; i++) {
      lastSocket().serverClose(1006);
      jest.advanceTimersByTime(2000);
    }

    // Without the clamp the 6th delay would be 1000 * 2^5 * 0.5 = 16000ms and
    // this 2000ms tick would not have produced a socket.
    expect(FakeWebSocket.instances).toHaveLength(7);
    expect(client.getStatus()).toBe("connecting");
  });

  it("refuses to reconnect after a 4001 auth-rejection close", () => {
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(4001);

    expect(client.getStatus()).toBe("failed");
    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("gives up with status 'failed' once maxReconnectAttempts is exhausted", () => {
    const client = new WSClient({ initialReconnectDelay: 10, maxReconnectAttempts: 2 });
    client.connect();

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(10);
    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(10);
    expect(FakeWebSocket.instances).toHaveLength(3);

    lastSocket().serverClose(1006); // third close — over the cap
    expect(client.getStatus()).toBe("failed");

    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("resets the attempt counter once a socket opens again", () => {
    const client = new WSClient({ initialReconnectDelay: 1000, maxReconnectAttempts: 2 });
    client.connect();

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(500);
    lastSocket().open(); // successful reconnect resets the counter

    lastSocket().serverClose(1006);
    expect(client.getStatus()).toBe("reconnecting");
    jest.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("cancels a pending reconnect when disconnect() is called", () => {
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().serverClose(1006);

    client.disconnect();
    jest.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe("disconnected");
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────

describe("WSClient lifecycle", () => {
  it("close() permanently blocks further connect() calls", () => {
    const client = new WSClient();
    client.close();

    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("close() suppresses reconnection from an in-flight socket close", () => {
    const client = new WSClient({ initialReconnectDelay: 10 });
    client.connect();
    const socket = lastSocket();
    socket.open();

    client.close();
    socket.serverClose(1006);
    jest.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("reconnect() lifts the shutdown flag set by close()", () => {
    const client = new WSClient();
    client.close();

    client.reconnect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.getStatus()).toBe("connecting");
  });

  it("disconnect() closes the underlying socket", () => {
    const client = new WSClient();
    client.connect();
    const socket = lastSocket();
    socket.open();

    client.disconnect();

    expect(socket.closeCalls).toBe(1);
  });

  it("disconnect() is safe to call before any connect()", () => {
    const client = new WSClient();

    expect(() => client.disconnect()).not.toThrow();
    expect(client.getStatus()).toBe("disconnected");
  });
});

// ── send() ───────────────────────────────────────────────────────────

describe("WSClient send", () => {
  it("serialises the payload over an OPEN socket", () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();

    client.send({ type: "ping", n: 1 });

    expect(lastSocket().sent).toEqual(['{"type":"ping","n":1}']);
  });

  it("drops the payload when the socket is not OPEN", () => {
    const client = new WSClient();
    client.connect(); // still CONNECTING

    client.send({ type: "ping" });

    expect(lastSocket().sent).toEqual([]);
  });

  it("drops the payload when there is no socket at all", () => {
    const client = new WSClient();

    expect(() => client.send({ type: "ping" })).not.toThrow();
  });
});

// ── Heartbeat ────────────────────────────────────────────────────────

describe("WSClient heartbeat", () => {
  it("emits a heartbeat frame on each interval tick", () => {
    const client = new WSClient({ heartbeatInterval: 1000, heartbeatTimeout: 5 });
    client.connect();
    lastSocket().open();

    jest.advanceTimersByTime(2000);

    expect(lastSocket().sent).toEqual(['{"type":"heartbeat"}', '{"type":"heartbeat"}']);
    expect(client.getStatus()).not.toBe("failed");
  });

  it("force-closes the socket after heartbeatTimeout unanswered beats", () => {
    const client = new WSClient({ heartbeatInterval: 1000, heartbeatTimeout: 3 });
    client.connect();
    const socket = lastSocket();
    socket.open();

    jest.advanceTimersByTime(2000);
    expect(socket.closeCalls).toBe(0);

    jest.advanceTimersByTime(1000); // third missed beat
    expect(socket.closeCalls).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith("[WS] Heartbeat timeout — forcing reconnect");
  });

  it("keeps the socket alive indefinitely while pongs keep arriving", () => {
    const client = new WSClient({ heartbeatInterval: 1000, heartbeatTimeout: 3 });
    client.connect();
    const socket = lastSocket();
    socket.open();

    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(1000);
      socket.receive({ type: "pong" });
    }

    expect(socket.closeCalls).toBe(0);
  });

  it("stops the heartbeat once the socket closes", () => {
    const client = new WSClient({ heartbeatInterval: 1000, heartbeatTimeout: 3 });
    client.connect();
    const socket = lastSocket();
    socket.open();
    jest.advanceTimersByTime(1000);
    const sentBefore = socket.sent.length;

    client.close();
    jest.advanceTimersByTime(10_000);

    expect(socket.sent).toHaveLength(sentBefore);
  });
});
