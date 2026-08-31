/**
 * Tests for src/contexts/WebSocketContext.tsx.
 *
 * Wired end-to-end on purpose: the real WSClient and the real event registry
 * sit behind a fake WebSocket global. That is the only way to catch the
 * failure this provider is prone to — the socket opening but nothing
 * reaching the cache or the toast layer, which looks identical to "quiet
 * day" from the outside.
 *
 * Covered refusals: no socket while unauthenticated, no socket without a
 * token, no toast for a malformed frame, no reconnect after a 4001 close,
 * and teardown on logout/unmount.
 */
import { render, screen, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebSocketProvider, useWebSocket } from "@/src/contexts/WebSocketContext";

// ── Fake WebSocket ───────────────────────────────────────────────────

type Handler = ((ev: unknown) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;

  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;

  constructor(url: string) {
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

// ── Mocked surroundings ──────────────────────────────────────────────

const mockShowToast = jest.fn();
let mockUser: { id: number; username: string } | null = { id: 1, username: "yama" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

function setToken(token: string | null) {
  // sessionStorage, not a cookie — the WS clients read only sessionStorage
  // now. See src/__tests__/support/wsHarness.ts::setToken for why.
  document.cookie = "soulledger_access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  sessionStorage.clear();
  if (token !== null) sessionStorage.setItem("soulledger_access", token);
}

/** Consumer that surfaces the whole context value in the DOM. */
function Probe() {
  const { status, isConnected, send, reconnect } = useWebSocket();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="connected">{String(isConnected)}</span>
      <button onClick={() => send({ type: "ping" })}>send</button>
      <button onClick={() => reconnect()}>reconnect</button>
    </div>
  );
}

let queryClient: QueryClient;
let invalidateSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

function renderProvider() {
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

const status = () => screen.getByTestId("status").textContent;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  FakeWebSocket.instances = [];
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  setToken("jwt-token");
  mockUser = { id: 1, username: "yama" };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  jest.useRealTimers();
});

const invalidatedKeys = () =>
  invalidateSpy.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));

// ── Authentication gating ────────────────────────────────────────────

describe("WebSocketProvider authentication gating", () => {
  it("opens no socket at all while there is no logged-in user", () => {
    mockUser = null;

    renderProvider();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(status()).toBe("disconnected");
    expect(screen.getByTestId("connected").textContent).toBe("false");
  });

  it("opens a socket once a user is present", () => {
    renderProvider();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toContain("token=jwt-token");
    expect(status()).toBe("connecting");
  });

  it("stays disconnected when a user exists but no auth token is stored", () => {
    setToken(null);

    renderProvider();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(status()).toBe("disconnected");
  });

  it("tears the socket down when the user logs out", () => {
    const { rerender } = renderProvider();
    const socket = lastSocket();
    act(() => socket.open());

    mockUser = null;
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <Probe />
          </WebSocketProvider>
        </QueryClientProvider>,
      );
    });

    expect(socket.closeCalls).toBeGreaterThan(0);
  });

  it("closes the socket on unmount", () => {
    const { unmount } = renderProvider();
    const socket = lastSocket();
    act(() => socket.open());

    unmount();

    expect(socket.closeCalls).toBe(1);
  });

  it("does not reconnect after unmount", () => {
    const { unmount } = renderProvider();
    act(() => lastSocket().open());

    unmount();
    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

// ── Status propagation ───────────────────────────────────────────────

describe("WebSocketProvider status propagation", () => {
  it("reports connected only after the server handshake frame", () => {
    renderProvider();
    act(() => lastSocket().open());
    expect(screen.getByTestId("connected").textContent).toBe("false");

    act(() => lastSocket().receive({ type: "connected", user_id: 1, tenant_code: "CN", permissions: [] }));

    expect(status()).toBe("connected");
    expect(screen.getByTestId("connected").textContent).toBe("true");
  });

  it("surfaces the reconnecting state after an unexpected drop", () => {
    renderProvider();
    act(() => lastSocket().open());
    act(() => lastSocket().receive({ type: "connected" }));

    act(() => lastSocket().serverClose(1006));

    expect(status()).toBe("reconnecting");
    expect(screen.getByTestId("connected").textContent).toBe("false");
  });

  it("re-opens a socket after the backoff delay", () => {
    renderProvider();
    act(() => lastSocket().open());
    act(() => lastSocket().serverClose(1006));

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  it("surfaces 'failed' and stops retrying after an auth rejection (4001)", () => {
    renderProvider();
    act(() => lastSocket().open());

    act(() => lastSocket().serverClose(4001));

    expect(status()).toBe("failed");
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

// ── Event fan-out ────────────────────────────────────────────────────

describe("WebSocketProvider event fan-out", () => {
  function connected() {
    renderProvider();
    act(() => lastSocket().open());
    act(() => lastSocket().receive({ type: "connected" }));
    invalidateSpy.mockClear();
    mockShowToast.mockClear();
  }

  it("routes a notification frame into the notification caches and a toast", () => {
    connected();

    act(() =>
      lastSocket().receive({
        type: "notification",
        notification: { id: 5, title: "Verdict", message: "signed" },
      }),
    );

    expect(invalidatedKeys()).toEqual(['["notifications"]', '["notifications-unread-count"]']);
    expect(mockShowToast).toHaveBeenCalledWith("Verdict: signed", "info", 5000);
  });

  it("routes a workflow frame into the workflow caches with the right severity", () => {
    connected();

    act(() =>
      lastSocket().receive({
        type: "workflow",
        event: "WORKFLOW_REJECTED",
        workflow_id: "w1",
        soul_name: "Meng",
      }),
    );

    expect(invalidatedKeys()).toContain('["workflows","detail","w1"]');
    expect(mockShowToast).toHaveBeenCalledWith("Workflow rejected — Meng", "error", 6000);
  });

  it("routes a generic domain frame through the event registry", () => {
    connected();

    act(() =>
      lastSocket().receive({ type: "broadcast", domain: "social", event: "POST_CREATED", author_name: "Ann" }),
    );

    expect(invalidatedKeys()).toContain('["social","posts"]');
    expect(mockShowToast).toHaveBeenCalledWith("New post — Ann", "info", 4000);
  });

  it("ignores a malformed frame — no cache churn, no toast, still connected", () => {
    connected();

    act(() => lastSocket().receive("<<< not json >>>"));

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(status()).toBe("connected");
  });

  it("ignores a frame whose type is unknown and which carries no domain/event", () => {
    connected();

    act(() => lastSocket().receive({ type: "gossip", payload: 42 }));

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("does not toast on a server error frame", () => {
    connected();

    act(() => lastSocket().receive({ type: "error", message: "nope" }));

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[WS] Server error:", "nope");
  });

  it("keeps processing frames after a malformed one", () => {
    connected();

    act(() => lastSocket().receive("garbage"));
    act(() => lastSocket().receive({ type: "notification", notification: { id: 1, title: "Later" } }));

    expect(mockShowToast).toHaveBeenCalledWith("Later", "info", 5000);
  });
});

// ── Imperative API ───────────────────────────────────────────────────

describe("WebSocketProvider imperative API", () => {
  it("send() writes to the socket once it is open", () => {
    renderProvider();
    act(() => lastSocket().open());

    fireEvent.click(screen.getByText("send"));

    expect(lastSocket().sent).toContain('{"type":"ping"}');
  });

  it("send() drops the message while the socket is still connecting", () => {
    renderProvider();

    fireEvent.click(screen.getByText("send"));

    expect(lastSocket().sent).toEqual([]);
  });

  it("send() is a no-op — not a crash — when unauthenticated", () => {
    mockUser = null;
    renderProvider();

    expect(() => fireEvent.click(screen.getByText("send"))).not.toThrow();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("reconnect() closes the current socket and opens a fresh one", () => {
    renderProvider();
    const first = lastSocket();
    act(() => first.open());

    act(() => {
      fireEvent.click(screen.getByText("reconnect"));
    });

    expect(first.closeCalls).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(lastSocket()).not.toBe(first);
  });
});

// ── Default context ──────────────────────────────────────────────────

describe("useWebSocket outside a provider", () => {
  it("returns inert defaults instead of throwing", () => {
    render(<Probe />);

    expect(status()).toBe("disconnected");
    expect(screen.getByTestId("connected").textContent).toBe("false");
    expect(() => fireEvent.click(screen.getByText("send"))).not.toThrow();
    expect(() => fireEvent.click(screen.getByText("reconnect"))).not.toThrow();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
