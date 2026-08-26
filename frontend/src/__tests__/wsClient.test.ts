/**
 * Tests for lib/ws/client.ts — the notification WebSocket state machine, part
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
import { WSClient, type WSStatus } from "@/lib/ws/client";

import { FakeWebSocket, installWsHarness, lastSocket, setToken } from "./support/wsHarness";

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
