/**
 * Tests for packages/core/src/ws/client.ts — the notification WebSocket state machine, part
 * one: who is allowed to open a socket, and what arriving frames turn into.
 *
 * This client is the whole realtime channel: if it silently stops
 * reconnecting, or swallows a message type, every toast/notification in the
 * app goes quiet with no error anywhere. The tests below therefore assert
 * *refusals* as much as successes — no socket without a token, no
 * generic-event dispatch for a payload missing domain/event.
 *
 * The other half — reconnection, lifecycle, send, heartbeat — lives in
 * `wsClient.reconnect.test.ts`. Both files drive the same fake socket, which
 * is defined once in `support/wsHarness.ts` so the two cannot drift apart.
 */
import { WSClient, type WSStatus } from "@soulledger/core/ws/client";

import { FakeWebSocket, installWsHarness, lastSocket, setLegacyCookieToken, setToken } from "./support/wsHarness";

const harness = installWsHarness();

// ── Auth gate ────────────────────────────────────────────────────────
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

  it("takes the token from sessionStorage", () => {
    setToken(null);
    sessionStorage.setItem("soulledger_access", "session-tok");

    new WSClient().connect();

    expect(lastSocket().url).toContain("token=session-tok");
  });

  it("ignores a stale soulledger_access cookie", () => {
    // 这条曾经是反过来的:「cookie 优先于 sessionStorage」。那正是缺陷 ——
    // 刷新拦截器把 access 写成一个 `max-age=86400` 的 cookie(而 access 只活
    // 30 分钟),读取端又是 cookie 优先,于是那个 24 小时的值一直赢。
    // 现在两个 WS 客户端都只认 sessionStorage,而拦截器会清掉残留的 cookie。
    setToken("session-tok");
    setLegacyCookieToken("cookie-tok");

    new WSClient().connect();

    expect(lastSocket().url).toContain("token=session-tok");
    expect(lastSocket().url).not.toContain("cookie-tok");
  });

  it("没有 token 时不开 socket —— **断存在的反面**", () => {
    setToken(null);
    new WSClient().connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
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

    expect(harness.warnSpy).toHaveBeenCalledWith("[WS] Server error:", "permission denied");
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

describe("permission.refreshed", () => {
  /**
   * 后端一直在应答 `{"type":"permission.refresh"}`,回一条
   * `{"type":"permission.refreshed", "permissions":[...]}`
   * (`apps/core/ws_permissions.py:59-68`)。前端的 message-type switch 里
   * **没有这个 case** —— 落到 default,而 default 只在有 `domain`+`event` 时
   * 才分发,所以那条应答被静默丢弃。
   *
   * 全仓 grep `permission.refresh` 零命中:通道两端都在,中间没有接线。
   */
  it("把服务端送回的新权限集交给回调", () => {
    setToken("tok");
    const onPermissionsRefreshed = jest.fn();
    new WSClient({ onPermissionsRefreshed }).connect();

    lastSocket().onmessage?.({
      data: JSON.stringify({
        type: "permission.refreshed",
        permissions: ["soul.read", "ledger.read"],
      }),
    } as MessageEvent);

    expect(onPermissionsRefreshed).toHaveBeenCalledWith(["soul.read", "ledger.read"]);
  });

  it("没有 permissions 字段时给一个空数组,而不是 undefined", () => {
    // 调用方会 `.map` 它。`undefined` 会在调用方那里炸,而炸的地方离原因很远。
    setToken("tok");
    const onPermissionsRefreshed = jest.fn();
    new WSClient({ onPermissionsRefreshed }).connect();

    lastSocket().onmessage?.({
      data: JSON.stringify({ type: "permission.refreshed" }),
    } as MessageEvent);

    expect(onPermissionsRefreshed).toHaveBeenCalledWith([]);
  });

  it("**断存在的反面。** 它不再落到通用事件分发上", () => {
    setToken("tok");
    const onGenericEvent = jest.fn();
    new WSClient({ onGenericEvent }).connect();

    lastSocket().onmessage?.({
      data: JSON.stringify({ type: "permission.refreshed", permissions: [] }),
    } as MessageEvent);

    expect(onGenericEvent).not.toHaveBeenCalled();
  });
});
