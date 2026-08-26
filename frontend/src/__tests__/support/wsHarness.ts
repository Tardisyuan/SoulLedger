/**
 * Shared fixture for the `lib/ws/client.ts` suites.
 *
 * `wsClient.test.ts` and `wsClient.reconnect.test.ts` are two halves of one
 * set of tests and need byte-identical surroundings: the same fake socket, the
 * same token plumbing, the same console spy. Copying the harness into both
 * files would let the two copies drift, and a drifted fake is the worst kind
 * of test double — it makes correct code look broken in one file and broken
 * code look fine in the other. So there is exactly one copy, here.
 *
 * This file is deliberately NOT named `*.test.ts`: `jest.config.js`'s
 * `testMatch` and `suiteShape.test.ts`'s directory walk both key on that
 * suffix, and a fixture is neither a suite nor something the suite list should
 * carry.
 */

type Handler = ((ev: unknown) => void) | null;

export class FakeWebSocket {
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

export const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

export function setToken(token: string | null) {
  document.cookie = "soulledger_access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  sessionStorage.clear();
  if (token !== null) document.cookie = `soulledger_access=${token}; path=/`;
}

/** Handle onto the per-test console spy, filled in by the registered hook. */
export interface WsHarness {
  warnSpy: jest.SpyInstance;
}

/**
 * Registers the `beforeEach`/`afterEach` pair both suites share and returns a
 * handle whose `warnSpy` is rebound before every test. Call it once at the top
 * level of a suite file.
 */
export function installWsHarness(): WsHarness {
  const harness = { warnSpy: undefined as unknown as jest.SpyInstance };

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
    FakeWebSocket.throwOnConstruct = false;
    (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    setToken("tok-123");
    // The client warns on server errors and heartbeat timeouts by design;
    // spying keeps the assertions explicit and the test output clean.
    harness.warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    harness.warnSpy.mockRestore();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  return harness;
}
