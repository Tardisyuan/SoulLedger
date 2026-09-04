/**
 * A session that comes back has to bring its socket back with it.
 *
 * `packages/core/src/ws/client.ts` keeps liveness with a `setInterval`
 * heartbeat and re-opens the socket from exactly one place: the `onclose`
 * handler, via `scheduleReconnect()`. Both of those are timers, and a host that
 * suspends the JavaScript loop — React Native backgrounding the app; a browser
 * putting the page in the back/forward cache — freezes them. So the socket dies
 * while nothing is running to notice, and the client comes back believing it is
 * still connected, or waiting on a backoff timer that was paused mid-count.
 * `WSClient.reconnect()` has always existed; `platform.onSessionResume` (added
 * by `c8863fb`) is its trigger, and until this file there was no line joining
 * the two. `packages/core/src/platform/index.ts:165` says so in its own doc:
 * the port being there does not by itself fix anything.
 *
 * WHY THIS SUITE LOOKS EXPENSIVE. `platformPortsSecureAndResume.test.ts`
 * already proves the port routes to the adapter, and `wsClient.reconnect.test.ts`
 * already proves `reconnect()` opens a socket — which is precisely why neither
 * can fail for this cause: each supplies by hand the one thing the wiring was
 * missing. So this file drives the REAL `WebSocketProvider`, the REAL
 * `WSClient` behind a fake socket, and the REAL browser adapter that
 * `jest.setup.js` installs — the resume is triggered by dispatching an actual
 * `pageshow` event with `persisted === true`, which is what
 * `frontend/lib/platform/web.ts:170` listens for. Nothing about the resume path
 * is stubbed.
 *
 * The fake socket is the shared one from `./support/wsHarness`. A second copy
 * of a stub is a second chance to be wrong, and this repo has the scar: that
 * fixture's `close()` did not fire `onclose` for a long time, and the zombie
 * reconnect it hid is written up in `WSClient.disconnect()`. Its `beforeEach`
 * pair is NOT reused — `installWsHarness` runs `runOnlyPendingTimers()` in an
 * `afterEach` that would fire while a React tree is still mounted.
 */
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebSocketProvider, useWebSocket } from "@/src/contexts/WebSocketContext";

import { FakeWebSocket, lastSocket, setToken } from "./support/wsHarness";

// ── Mocked surroundings ──────────────────────────────────────────────
//
// Only the two contexts the provider reads. Everything below it — WSClient,
// the platform adapter, the event registry — is the production article.

const mockShowToast = jest.fn();
let mockUser: { id: number; username: string } | null = { id: 1, username: "yama" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

/**
 * The browser's "a suspended session came back", as the web adapter defines it.
 *
 * A plain `pageshow` is the ordinary first paint and is deliberately NOT a
 * resume; only `persisted === true` (a bfcache restore) is. jsdom does not
 * construct `PageTransitionEvent`, so the flag is planted on a plain `Event` —
 * which is all the adapter reads.
 */
function fireSessionResume({ persisted = true } = {}) {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  act(() => {
    window.dispatchEvent(event);
  });
}

function Probe() {
  const { status } = useWebSocket();
  return <span data-testid="status">{status}</span>;
}

let queryClient: QueryClient;
let warnSpy: jest.SpyInstance;

/**
 * How many `pageshow` listeners are currently on `window`.
 *
 * Counted through the real `addEventListener`/`removeEventListener` — both
 * spies call through — because the leak this pins is invisible from behaviour.
 * See the test that uses it for why that had to be discovered rather than
 * assumed.
 */
let pageshowListeners = 0;
/** Cumulative, never decremented: how many times a subscription was BUILT. */
let pageshowAdds = 0;
const realAdd = window.addEventListener.bind(window);
const realRemove = window.removeEventListener.bind(window);
let addSpy: jest.SpyInstance;
let removeSpy: jest.SpyInstance;

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

/** Mount, open the socket, and take the server handshake — a healthy link. */
function connected() {
  renderProvider();
  act(() => lastSocket().open());
  act(() => lastSocket().receive({ type: "connected", user_id: 1, tenant_code: "CN", permissions: [] }));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnConstruct = false;
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  setToken("jwt-token");
  mockUser = { id: 1, username: "yama" };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

  pageshowListeners = 0;
  pageshowAdds = 0;
  addSpy = jest
    .spyOn(window, "addEventListener")
    .mockImplementation((...args: Parameters<typeof realAdd>) => {
      if (args[0] === "pageshow") {
        pageshowListeners += 1;
        pageshowAdds += 1;
      }
      realAdd(...args);
    });
  removeSpy = jest
    .spyOn(window, "removeEventListener")
    .mockImplementation((...args: Parameters<typeof realRemove>) => {
      if (args[0] === "pageshow") pageshowListeners -= 1;
      realRemove(...args);
    });
});

afterEach(() => {
  addSpy.mockRestore();
  removeSpy.mockRestore();
  warnSpy.mockRestore();
  jest.useRealTimers();
});

// ── The gap ──────────────────────────────────────────────────────────

describe("WebSocketProvider reconnects when the session resumes", () => {
  /**
   * The terminal case. A 4001 close is the one the client refuses to retry
   * (`shouldReconnectAfterClose`), so `status` is `"failed"` and no timer,
   * however long you wait, will ever open another socket. Advancing two
   * minutes first is the half that makes this a test of the resume and not of
   * the backoff: if the clock could have fixed it, the last assertion proves
   * nothing.
   */
  it("re-opens a socket the client had permanently given up on", () => {
    connected();
    act(() => lastSocket().serverClose(4001));
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(status()).toBe("failed");
    expect(FakeWebSocket.instances).toHaveLength(1);

    fireSessionResume();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(status()).toBe("connecting");
  });

  /**
   * The ordinary case, and the one the doc on `SessionResumeSubscriber`
   * describes: the drop happened while the loop was frozen, so a backoff timer
   * is pending but paused mid-count. The resume must not wait it out — the
   * operator is looking at the screen now.
   */
  it("re-opens immediately rather than serving out a backoff that was paused", () => {
    connected();
    act(() => lastSocket().serverClose(1006));
    expect(status()).toBe("reconnecting");
    expect(FakeWebSocket.instances).toHaveLength(1);

    // No advanceTimersByTime: the clock stands exactly where the suspend left
    // it. Only the resume can produce a socket here.
    fireSessionResume();

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  /**
   * Absence, counted rather than read off a status string. A resume onto a
   * healthy link must be a no-op: tearing the socket down every time the
   * operator steps back into the tab would trade a rare dead socket for a
   * guaranteed gap in delivery. `WSClient.connect()` already refuses to build a
   * second socket over an OPEN one — asserting the count here is what keeps
   * that refusal load-bearing, since it lives in a file this one does not own.
   */
  it("opens no second socket, and closes none, when the link is already healthy", () => {
    connected();
    const socket = lastSocket();

    fireSessionResume();
    fireSessionResume();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.closeCalls).toBe(0);
    expect(status()).toBe("connected");
  });

  /**
   * The case that decides the guard, and the reason there is no status check
   * in the effect.
   *
   * `WSClient._status` only leaves `"connected"` from inside `onclose`. Freeze
   * the loop, let the peer go away, and that callback is exactly what does not
   * run — so the client comes back reporting `"connected"` over a socket that
   * is already CLOSED. Modelled here by moving `readyState` without firing
   * `onclose`, which is what "the close event was dropped" means.
   *
   * An `if (getStatus() === "connected") return;` in the effect reads like
   * prudence and would pass every other test in this file. It fails here,
   * because it declines to act in precisely the situation the subscription was
   * added for. The decision is delegated to `WSClient.connect()`'s
   * `readyState` check instead, which is looking at the socket rather than at
   * a cached opinion about it.
   */
  it("re-opens when the status still says connected but the socket is gone", () => {
    connected();
    expect(status()).toBe("connected");

    // The peer went away while the loop was frozen; no onclose was delivered.
    lastSocket().readyState = FakeWebSocket.CLOSED;
    expect(status()).toBe("connected");

    fireSessionResume();

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  /** A plain first paint is not a resume. The adapter's `persisted` gate. */
  it("ignores a pageshow that is not a bfcache restore", () => {
    connected();
    act(() => lastSocket().serverClose(4001));

    fireSessionResume({ persisted: false });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(status()).toBe("failed");
  });

  /**
   * The unsubscribe is real, and this counts listeners rather than sockets.
   *
   * WHY, STATED BECAUSE THE OBVIOUS VERSION OF THIS TEST CANNOT FAIL. The first
   * draft was behavioural — unmount, fire a resume, assert no new socket — and
   * it stayed green against a deliberately broken effect that never returned
   * its unsubscribe. It had to: the connect effect's own cleanup sets
   * `clientRef.current = null`, so a leaked listener calls `null?.reconnect()`
   * and does nothing observable. The assertion was true for a reason that had
   * nothing to do with the thing it claimed to check.
   *
   * The leak is still worth pinning — `onSessionResume` puts a handler on
   * `window`, which outlives the tree — but it is only visible at the
   * mechanism, so that is where it is asserted. The behavioural half is kept
   * below it as a statement of consequence, not as the check.
   */
  it("removes its window listener when the provider unmounts", () => {
    const { unmount } = renderProvider();
    act(() => lastSocket().open());
    expect(pageshowListeners).toBe(1);

    unmount();

    expect(pageshowListeners).toBe(0);
    fireSessionResume();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  /**
   * One listener for the life of the provider, not one per render.
   *
   * The effect carries an empty dependency array and reaches the client
   * through `clientRef` at call time. Nothing else in this file pins that:
   * deps of `[user]` or `[status]` stay correct — the cleanup runs, so the
   * NET listener count is 1 either way — they just tear the subscription down
   * and rebuild it on each of the identity changes `TenantContext`'s async
   * hydration causes. Which is why the assertion below is on the cumulative
   * count of subscriptions built, not on how many are live; the live count
   * cannot tell the two apart, as a mutation to `[user]` demonstrated.
   */
  it("subscribes once, not once per render", () => {
    const { rerender } = renderProvider();
    act(() => lastSocket().open());
    act(() => lastSocket().receive({ type: "connected" }));
    expect(pageshowAdds).toBe(1);

    // A new `user` object identity, as hydration produces — same user.
    mockUser = { id: 1, username: "yama" };
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <Probe />
          </WebSocketProvider>
        </QueryClientProvider>,
      );
    });

    // The cumulative count, not the live one. Both are asserted because they
    // fail for different mutations: `[user]` deps keep the live count at 1
    // while building a second subscription, and a missing cleanup keeps the
    // cumulative count at 1 while leaving two listeners behind.
    expect(pageshowAdds).toBe(1);
    expect(pageshowListeners).toBe(1);
  });

  /** No user, no socket — a resume must not be a way around the auth gate. */
  it("opens nothing on resume while nobody is signed in", () => {
    mockUser = null;
    renderProvider();
    expect(FakeWebSocket.instances).toHaveLength(0);

    fireSessionResume();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(status()).toBe("disconnected");
  });
});
