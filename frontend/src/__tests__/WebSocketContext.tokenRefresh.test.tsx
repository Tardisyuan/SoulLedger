/**
 * A refreshed access token has to bring a rejected socket back.
 *
 * THE GAP. `WSClient` closes with `"failed"` on a 4001 and — deliberately, see
 * `shouldReconnectAfterClose` — never retries it: the token was refused, and
 * retrying a refused token is a loop. `api/client.ts` meanwhile refreshes that
 * token on the next 401 and carries on. Nothing joined the two. After the
 * access token expired mid-session the REST side healed itself on the next
 * request and the realtime side stayed dead until a full reload (FL-04).
 * `WebSocketContext.sessionResume.test.tsx` is the same shape one port over:
 * `WSClient.reconnect()` existed the whole time and lacked a trigger.
 *
 * THE TRIGGER is `onAccessTokenChanged` in `packages/core/src/platform`,
 * fired by `setAccessToken` — the one write both the login page and
 * `rotateRefreshToken` go through. The provider subscribes and calls
 * `clientRef.current?.reconnect()`, whose `connect()` returns early over an
 * OPEN or CONNECTING socket, so a healthy link is untouched.
 *
 * DRIVEN THROUGH THE REAL REFRESH, not by calling `setAccessToken` directly.
 * The claim is "a successful refresh reconnects the socket"; a test that
 * called the port itself would stay green if `rotateRefreshToken` stopped
 * going through the port. Only `axios.post` is stubbed, and the fake socket is
 * the shared one from `./support/wsHarness` for the reason its header gives.
 */
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebSocketProvider, useWebSocket } from "@/src/contexts/WebSocketContext";
import { rotateRefreshToken } from "@soulledger/core/api/client";
import * as platformModule from "@soulledger/core/platform";

import { FakeWebSocket, lastSocket, setToken } from "./support/wsHarness";

jest.mock("axios", () => {
  const post = jest.fn(async () => ({
    data: { access: "jwt-refreshed", refresh: "refresh-2" },
  }));
  return {
    __esModule: true,
    default: {
      post,
      create: () => ({
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() },
        },
      }),
    },
  };
});

const mockShowToast = jest.fn();
let mockUser: { id: number; username: string } | null = { id: 1, username: "yama" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

function Probe() {
  const { status } = useWebSocket();
  return <span data-testid="status">{status}</span>;
}

let queryClient: QueryClient;
let warnSpy: jest.SpyInstance;
/** Live subscriptions on the token port, counted at the mechanism. */
let tokenListeners = 0;
/** Cumulative: how many subscriptions were BUILT. */
let tokenSubscribes = 0;
let subscribeSpy: jest.SpyInstance;

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

function connected() {
  renderProvider();
  act(() => lastSocket().open());
  act(() => lastSocket().receive({ type: "connected", user_id: 1, tenant_code: "CN", permissions: [] }));
}

async function refreshSucceeds() {
  await act(async () => {
    await rotateRefreshToken("refresh-1");
  });
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

  tokenListeners = 0;
  tokenSubscribes = 0;
  // Wraps the real port: counts the subscription and its unsubscribe. This is
  // the only way the leak below is observable — see the unmount test.
  const real = platformModule.onAccessTokenChanged;
  subscribeSpy = jest
    .spyOn(platformModule, "onAccessTokenChanged")
    .mockImplementation((handler: () => void) => {
      tokenListeners += 1;
      tokenSubscribes += 1;
      const off = real(handler);
      return () => {
        tokenListeners -= 1;
        off();
      };
    });
});

afterEach(() => {
  subscribeSpy.mockRestore();
  warnSpy.mockRestore();
  jest.useRealTimers();
});

describe("WebSocketProvider reconnects after a successful token refresh", () => {
  /**
   * The case this exists for. Two minutes on the clock first, so that the
   * last assertion is about the refresh and not about a backoff that would
   * have fired anyway — after 4001 there is no such backoff, and this proves
   * it before relying on it.
   */
  it("re-opens a socket the client had given up on after 4001, with the new token", async () => {
    connected();
    act(() => lastSocket().serverClose(4001));
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(status()).toBe("failed");
    expect(FakeWebSocket.instances).toHaveLength(1);

    await refreshSucceeds();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(lastSocket().url).toContain("token=jwt-refreshed");
    expect(lastSocket().url).not.toContain("token=jwt-token");
    expect(status()).toBe("connecting");
  });

  /**
   * Absence, counted. A refresh lands every thirty minutes on a healthy
   * session; tearing the socket down each time would be a guaranteed gap in
   * delivery to fix a rare one. `WSClient.connect()` refuses a second socket
   * over an OPEN one, and that refusal is in a file this one does not own —
   * so the count is asserted here, not assumed.
   */
  it("opens no second socket, and closes none, when the link is healthy", async () => {
    connected();
    const socket = lastSocket();

    await refreshSucceeds();
    await refreshSucceeds();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.closeCalls).toBe(0);
    expect(status()).toBe("connected");
  });

  /**
   * The subscription is torn down with the provider, and this counts
   * listeners rather than sockets: after unmount the connect effect's cleanup
   * has already nulled `clientRef`, so a leaked handler calling
   * `null?.reconnect()` would leave the behavioural assertion green for a
   * reason unrelated to the leak. Same argument, same shape, as the
   * `pageshow` listener test one file over.
   */
  it("unsubscribes when the provider unmounts", async () => {
    const { unmount } = renderProvider();
    act(() => lastSocket().open());
    expect(tokenListeners).toBe(1);

    unmount();

    expect(tokenListeners).toBe(0);
    await refreshSucceeds();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  /** One subscription for the life of the provider, not one per `user` identity. */
  it("subscribes once, not once per render", () => {
    const { rerender } = renderProvider();
    act(() => lastSocket().open());
    expect(tokenSubscribes).toBe(1);

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

    expect(tokenSubscribes).toBe(1);
    expect(tokenListeners).toBe(1);
  });

  /** No user, no socket — a refresh must not be a way around the auth gate. */
  it("opens nothing on refresh while nobody is signed in", async () => {
    mockUser = null;
    renderProvider();
    expect(FakeWebSocket.instances).toHaveLength(0);

    await refreshSucceeds();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(status()).toBe("disconnected");
  });
});
