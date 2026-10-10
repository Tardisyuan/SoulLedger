import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WSClient,
  WS_CLOSE_AUTH_REJECTED,
  WS_CLOSE_SESSION_ENDED,
  CREDENTIAL_WAIT_MS,
  shouldReconnectAfterClose,
} from "../client";
import { trackCredentialChange } from "../../api/credentialChange";
import { ACCESS_TOKEN_KEY, configurePlatform, resetPlatform } from "../../platform/index";

/**
 * A close event that carries no `code`, through the realtime client.
 *
 * WHY THIS SUITE EXISTS. `host-globals.d.ts` declares the close event's `code`
 * as `readonly code?: number` — optional, deliberately, because this package
 * cannot promise every host delivers one. The client then compared it to a
 * number: `if (event.code === 4001)`. `undefined === 4001` is false, so on a
 * host that omits the code an auth rejection fell straight through to
 * `scheduleReconnect()` and was retried — 50 times here, forever in the since-
 * deleted `SocialWSClient`, whose `maxReconnectAttempts` default was
 * `Infinity`. The type admitted a case the code did not handle, and nothing
 * chose which way it should go.
 *
 * The choice is now made explicitly in `shouldReconnectAfterClose` (retry, for
 * the reasons argued over it) and this file is what holds the choice still.
 * It is a *characterisation* suite: it pins today's answer so that changing it
 * is a decision someone makes, not something that happens.
 *
 * WHY IT LIVES IN packages/core AND NOT IN frontend's jest suites. The existing
 * `wsClient.reconnect.test.ts` covers this class well, but its fixture (`frontend/src/__tests__/support/wsHarness.ts`)
 * dispatches `{ code }` on every path — `serverClose(code = 1006)`,
 * `close()` → 1005 — so the case under test cannot be expressed there without
 * changing a fixture another suite depends on. It also belongs here on the
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

  sent: string[] = [];

  send(frame: string): void {
    this.sent.push(frame);
  }

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
    // The token travels in the first frame, not the URL (see client.ts header).
    expect(lastSocket().url).not.toContain("tok-123");
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

describe("WSClient — the server ended the login (4002)", () => {
  it("is spelled 4002, matching apps/events/realtime.py, and is retried", () => {
    expect(WS_CLOSE_SESSION_ENDED).toBe(4002);
    expect(shouldReconnectAfterClose(WS_CLOSE_SESSION_ENDED)).toBe(true);
  });

  it("reconnects after 4002 and stays quiet when the new token is accepted", () => {
    const ended = vi.fn();
    const client = new WSClient({ onSessionEnded: ended });
    client.connect();
    lastSocket().open();
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);
    expect(client.getStatus()).toBe("reconnecting");

    vi.advanceTimersByTime(1100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().open();
    lastSocket().onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    lastSocket().serverClose(WS_CLOSE_AUTH_REJECTED);

    expect(ended).not.toHaveBeenCalled(); // the 4001 after a good reconnect is an ordinary one
    client.close();
  });

  it("reports the end of the login when the reconnect is refused with 4001", () => {
    const ended = vi.fn();
    const client = new WSClient({ onSessionEnded: ended });
    client.connect();
    lastSocket().open();
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);
    vi.advanceTimersByTime(1100);
    lastSocket().open();
    lastSocket().serverClose(WS_CLOSE_AUTH_REJECTED);

    expect(ended).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe("failed");
    client.close();
  });

  it("a plain 4001 without a preceding 4002 does not report it", () => {
    const ended = vi.fn();
    const client = new WSClient({ onSessionEnded: ended });
    client.connect();
    lastSocket().open();
    lastSocket().serverClose(WS_CLOSE_AUTH_REJECTED);
    expect(ended).not.toHaveBeenCalled();
    client.close();
  });
});

describe("WSClient — 4002 while this device is changing its password", () => {
  /** A change-password request we settle by hand. */
  const unsettled: (() => void)[] = [];
  function inFlight() {
    let finish!: () => void;
    const work = trackCredentialChange(new Promise<void>((resolve) => (finish = resolve)));
    unsettled.push(finish);
    return { work, finish };
  }
  afterEach(() => {
    // The registry is module-level: never leave a request pending for the next test.
    while (unsettled.length) unsettled.pop()!();
  });
  const tokenSent = (socket: FakeWebSocket) => JSON.parse(socket.sent[0] ?? "{}").token;
  let currentToken = "tok-123";
  beforeEach(() => {
    currentToken = "tok-123";
    configurePlatform({
      session: { ...emptyStore, get: (key: string) => (key === ACCESS_TOKEN_KEY ? currentToken : null) },
      persistent: emptyStore,
      secure: emptyStore,
      onUnauthorized: () => {},
      onSessionSuspend: () => () => {},
      onSessionResume: () => () => {},
      notify: () => {},
      baseUrl: "http://api.test/api/v1",
    });
  });

  it("does not reconnect while the request is in flight, then connects with the NEW token", async () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();
    const { finish } = inFlight();
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1); // the old 0.5-1 s reconnect would be long gone

    currentToken = "tok-new"; // the response arrived and the pair was stored...
    finish(); // ...and then the request settled
    await vi.advanceTimersByTimeAsync(1_100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().open();
    expect(tokenSent(lastSocket())).toBe("tok-new");
    client.close();
  });

  it("a failed request leaves the token alone and the client reconnects", async () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();
    let fail!: (e: Error) => void;
    const work = trackCredentialChange(new Promise<void>((_, reject) => (fail = reject)));
    work.catch(() => {});
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);
    fail(new Error("400"));
    await vi.advanceTimersByTimeAsync(1_100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.close();
  });

  it("with nothing in flight (every other device) it reconnects at once, as before", async () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.close();
  });

  it("a request that never settles holds the reconnect only up to the cap", async () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();
    inFlight(); // never finished
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);
    await vi.advanceTimersByTimeAsync(CREDENTIAL_WAIT_MS - 1_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.close();
  });

  it("disconnecting during the wait cancels the reconnect", async () => {
    const client = new WSClient();
    client.connect();
    lastSocket().open();
    const { finish } = inFlight();
    lastSocket().serverClose(WS_CLOSE_SESSION_ENDED);
    client.disconnect();
    finish();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
