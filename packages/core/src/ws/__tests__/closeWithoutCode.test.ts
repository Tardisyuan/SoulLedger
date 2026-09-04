import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WSClient, WS_CLOSE_AUTH_REJECTED, shouldReconnectAfterClose } from "../client";
import { SocialWSClient } from "../social-client";
import { ACCESS_TOKEN_KEY, configurePlatform, resetPlatform } from "../../platform/index";

/**
 * A close event that carries no `code`, through both realtime clients.
 *
 * WHY THIS SUITE EXISTS. `host-globals.d.ts` declares the close event's `code`
 * as `readonly code?: number` — optional, deliberately, because this package
 * cannot promise every host delivers one. Both clients then compared it to a
 * number: `if (event.code === 4001)`. `undefined === 4001` is false, so on a
 * host that omits the code an auth rejection fell straight through to
 * `scheduleReconnect()` and was retried — 50 times here, forever in the social
 * client, whose `maxReconnectAttempts` default is `Infinity`. The type admitted
 * a case the code did not handle, and nothing chose which way it should go.
 *
 * The choice is now made explicitly in `shouldReconnectAfterClose` (retry, for
 * the reasons argued over it) and this file is what holds the choice still.
 * It is a *characterisation* suite: it pins today's answer so that changing it
 * is a decision someone makes, not something that happens.
 *
 * WHY IT LIVES IN packages/core AND NOT IN frontend's jest suites. The existing
 * `wsClient.reconnect.test.ts` and `socialWsClient.test.ts` cover these classes
 * well, but their shared fixture (`frontend/src/__tests__/support/wsHarness.ts`)
 * dispatches `{ code }` on every path — `serverClose(code = 1006)`,
 * `close()` → 1005 — so the case under test cannot be expressed there without
 * changing a fixture two other suites depend on. It also belongs here on the
 * merits: the platform that omits a close code is exactly the non-browser
 * platform this package exists for, and vitest runs these with no DOM at all.
 *
 * THE FAKE DISPATCHES WHAT THE REAL THING WOULD. `closeWithoutCode()` calls
 * `onclose({})` — no `code` property, not `code: undefined` — because that is
 * what a host with no close code hands you, and the two are distinguishable to
 * `"code" in event`. The rest of the fake is the minimum `WSClient.connect()`
 * touches. It is not a re-implementation of the client's logic: every
 * assertion below reads the client's own status.
 */

type Handler = ((_ev: unknown) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // ── Test drivers ──────────────────────────────────────────────────

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  /** A close the host described. */
  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  /** A close the host did not describe: no `code` key at all. */
  closeWithoutCode(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }
}

const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

const emptyStore = { get: () => null, set: () => {}, remove: () => {} };

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  configurePlatform({
    session: { ...emptyStore, get: (key: string) => (key === ACCESS_TOKEN_KEY ? "tok-123" : null) },
    persistent: emptyStore,
    secure: emptyStore,
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    deliverOnExit: () => false,
    baseUrl: "http://api.test/api/v1",
  });
});

afterEach(() => {
  resetPlatform();
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

describe("shouldReconnectAfterClose", () => {
  it("says yes for a missing code — the deliberate answer, not the fallthrough", () => {
    expect(shouldReconnectAfterClose(undefined)).toBe(true);
  });

  it("says no for the auth rejection, and yes for the ordinary drops", () => {
    expect(shouldReconnectAfterClose(WS_CLOSE_AUTH_REJECTED)).toBe(false);
    expect(shouldReconnectAfterClose(1006)).toBe(true);
    expect(shouldReconnectAfterClose(1005)).toBe(true);
    expect(shouldReconnectAfterClose(1000)).toBe(true);
  });

  it("is spelled 4001, matching backend/apps/core/ws_auth.py", () => {
    expect(WS_CLOSE_AUTH_REJECTED).toBe(4001);
  });
});

describe("WSClient — a close with no code", () => {
  it("reconnects rather than reporting failed", () => {
    const statuses: string[] = [];
    const client = new WSClient({ onStatusChange: (s) => statuses.push(s) });
    client.connect();
    lastSocket().open();

    lastSocket().closeWithoutCode();

    expect(client.getStatus()).toBe("reconnecting");
    // Assert the absence too: "reconnecting" is reached through
    // `scheduleReconnect`, and "failed" is what the auth branch sets. A run
    // that visited both would still end on one of them.
    expect(statuses).not.toContain("failed");
    client.close();
  });

  it("still reaches the socket — the fake is wired, not inert", () => {
    // Guard the guard. If `connect()` had bailed before creating a socket (no
    // token, say), every assertion above would hold for the wrong reason.
    const client = new WSClient();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toContain("token=tok-123");
    client.close();
  });

  it("a 4001 close is still terminal — the case that must not have moved", () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(WS_CLOSE_AUTH_REJECTED);

    expect(client.getStatus()).toBe("failed");
    client.close();
  });

  it("does not schedule an attempt after 4001, but does after a code-less close", () => {
    // Status is what the UI sees; a timer is what actually retries. Assert both,
    // because a client that reported "failed" and reconnected anyway would pass
    // the status assertions above.
    const rejected = new WSClient();
    rejected.connect();
    lastSocket().open();
    lastSocket().serverClose(WS_CLOSE_AUTH_REJECTED);
    expect(vi.getTimerCount()).toBe(0);
    rejected.close();

    FakeWebSocket.instances = [];
    const dropped = new WSClient();
    dropped.connect();
    lastSocket().open();
    lastSocket().closeWithoutCode();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    vi.advanceTimersByTime(31000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    dropped.close();
  });
});

describe("SocialWSClient — a close with no code", () => {
  it("reconnects rather than going quiet", () => {
    const statuses: string[] = [];
    const client = new SocialWSClient({ onStatusChange: (s) => statuses.push(s) });
    client.connect();
    lastSocket().open();

    lastSocket().closeWithoutCode();

    expect(statuses).toContain("reconnecting");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    client.disconnect();
  });

  it("a 4001 close still stops it — with `Infinity` attempts, this is the branch that matters", () => {
    const statuses: string[] = [];
    const client = new SocialWSClient({ onStatusChange: (s) => statuses.push(s) });
    client.connect();
    lastSocket().open();

    lastSocket().serverClose(WS_CLOSE_AUTH_REJECTED);

    expect(statuses[statuses.length - 1]).toBe("disconnected");
    expect(statuses).not.toContain("reconnecting");
    expect(vi.getTimerCount()).toBe(0);
    client.disconnect();
  });
});
