/**
 * Tests for packages/core/src/ws/client.ts — the notification WebSocket state machine, part
 * two: what happens to a socket over time.
 *
 * Reconnection is the half that fails silently. A client that stops retrying
 * looks exactly like a quiet server, so these tests pin the backoff schedule,
 * the attempt ceiling, and — the important refusals — that a 4001 auth close
 * ends the retries and that `close()` is not undone by an in-flight socket
 * closing afterwards.
 *
 * The auth gate and message routing live in `wsClient.test.ts`. Both files
 * drive the same fake socket from `support/wsHarness.ts`.
 */
import { WSClient } from "@soulledger/core/ws/client";

import { FakeWebSocket, installWsHarness, lastSocket } from "./support/wsHarness";

const harness = installWsHarness();

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
    expect(harness.warnSpy).toHaveBeenCalledWith("[WS] Heartbeat timeout — forcing reconnect");
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


describe("disconnect() 不留僵尸连接", () => {
  /* `disconnect()` 曾经只是 `ws.close(); ws = null`。浏览器随后在那个已被丢弃的
     socket 上派发 close(code 1005 ≠ 4001),`onclose` 看到 `shutdown === false`,
     于是 `scheduleReconnect()` —— **一秒之后这个实例自己新建一个 WebSocket**,
     而 React 侧已经不持有它的引用了。它的 `onStatusChange` 还指着一个已卸载组件
     的 setState。

     `WebSocketContext` 的 cleanup 用的正是 `disconnect()`,而 `user` 对象在
     TenantContext 水合时至少变一次身份 —— **每次会话至少留下一个僵尸**。

     这两条测试在测试替身修好之前是**写不出来的**:`FakeWebSocket.close()` 从不
     派发 onclose,那条路径在测试里根本不存在。 */

  it("主动断开之后不再自己重连", async () => {
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().open();
    expect(FakeWebSocket.instances).toHaveLength(1);

    client.disconnect();
    await Promise.resolve();          // 让替身的 queueMicrotask 跑掉
    jest.advanceTimersByTime(10_000); // 远超第一次重连的退避

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("服务器主动断开时仍然会重连(反对照)", async () => {
    /* 没有这一条,一个「永不重连」的实现同样满足上面那条 —— 而那会让每一次
       网络抖动都变成一条再也不回来的连接。 */
    const client = new WSClient({ initialReconnectDelay: 1000 });
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(1006);
    jest.advanceTimersByTime(10_000);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });
});
