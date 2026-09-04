/**
 * The follow toast has to survive the user arriving LATE.
 *
 * `WebSocketProvider` reads `user` from `TenantContext`, which starts `null`
 * and hydrates in an effect. So the three `useCallback` handlers are first
 * created while `currentUserId` is `undefined`, and their dependency arrays
 * decide whether they are ever rebuilt with the real id. Neither `queryClient`
 * (pinned by `useState` in `QueryProvider`) nor `showToast` (the module-level
 * function reached through `ToastContext`'s default value, because
 * `WebSocketProvider` sits ABOVE `ToastProvider` in `app/layout.tsx`) ever
 * changes identity — so if `currentUserId` is not itself a dependency, every
 * session runs with `currentUserId === undefined` forever and
 * `handleSocialEvent`'s aim check (`lib/events/eventHandlers.ts`) can never
 * pass. Nothing leaks; the user simply never learns someone followed them.
 *
 * WHY THIS SUITE LOOKS EXPENSIVE. `eventRegistry.test.ts` already covers the
 * aim check by handing `currentUserId: "me"` straight to the handler — which
 * is precisely why it cannot fail for this cause: it supplies by hand the one
 * value the wiring drops. This file therefore drives the REAL
 * `TenantProvider` (hydrating asynchronously, as in production) and the REAL
 * `WSClient` behind a fake socket, and touches `currentUserId` only through
 * the id it plants in localStorage. A synchronously-present user would hide
 * the defect entirely.
 */
import { render, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantProvider } from "@/src/contexts/TenantContext";
import { WebSocketProvider } from "@/src/contexts/WebSocketContext";
import { showToast } from "@/src/components/ui/Toast";

// The toast layer, mocked at the module that `ToastContext`'s DEFAULT value
// points at. `ToastProvider` is deliberately NOT rendered below: in
// `app/layout.tsx` the WebSocket provider is the outer of the two, so the
// production `showToast` reference is exactly this module function.
jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(() => "toast-1"),
  dismissToast: jest.fn(),
  ToastContainer: () => null,
}));

// `TenantProvider` refetches permissions on rehydration. Only the hydration
// timing matters here, so the call is stubbed rather than left to the network.
jest.mock("@soulledger/core/api", () => ({
  permApi: {
    myRolePermissions: jest.fn(() =>
      Promise.resolve({ data: { permissions: [], role: "VIEWER" } }),
    ),
  },
}));

const mockShowToast = showToast as jest.MockedFunction<typeof showToast>;

// ── Fake WebSocket ───────────────────────────────────────────────────

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

  send() {}

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

// ── Fixture ──────────────────────────────────────────────────────────

const VIEWER_ID = 7;

/** Seed the cache `TenantProvider` hydrates from. Nothing else supplies the id. */
function seedCachedUser(id: number) {
  localStorage.setItem(
    "soulledger_user",
    JSON.stringify({
      user: {
        id,
        username: "mengpo",
        display_name: "孟婆",
        email: "mengpo@example.com",
        role: "VIEWER",
        tenant: { code: "CN_DIYU", display_name: "地狱" },
      },
      storedAt: Date.now(),
    }),
  );
}

let queryClient: QueryClient;

/**
 * Renders the provider pair, then waits for the socket the connect effect
 * opens. That socket only exists once `user` is non-null, so its arrival IS
 * the proof that hydration has completed — the handlers under test were built
 * one render earlier, with no user.
 */
async function renderAndHydrate() {
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <WebSocketProvider>
          <div />
        </WebSocketProvider>
      </TenantProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  await act(async () => {
    lastSocket().open();
  });
}

/** Push one server frame through the real WSClient message path. */
async function deliver(frame: Record<string, unknown>) {
  await act(async () => {
    lastSocket().receive(frame);
  });
}

const follow = (followingId: string) => ({
  domain: "social",
  event: "USER_FOLLOWED",
  following_id: followingId,
  follower_id: "42",
  author_name: "判官",
});

beforeEach(() => {
  jest.clearAllMocks();
  FakeWebSocket.instances = [];
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem("soulledger_access", "token-abc");
  seedCachedUser(VIEWER_ID);
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  queryClient.clear();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("WebSocketProvider carries the hydrated user id into its handlers", () => {
  it("toasts USER_FOLLOWED aimed at the viewer who arrived after mount", async () => {
    await renderAndHydrate();
    await deliver(follow(String(VIEWER_ID)));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining("判官"),
      "info",
      expect.any(Number),
    );
  });

  it("toasts USER_UNFOLLOWED aimed at the viewer too", async () => {
    await renderAndHydrate();
    await deliver({ ...follow(String(VIEWER_ID)), event: "USER_UNFOLLOWED" });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  // Absence, not just presence: a correct id in the closure is worth nothing
  // if the gate has stopped discriminating. Were the aim check to degrade into
  // "toast every follow", the test above would stay green on its own.
  it("stays silent for a follow aimed at somebody else", async () => {
    await renderAndHydrate();
    await deliver(follow("999"));

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // The other half of the gate: an event with no `following_id` at all must
  // not match a viewer whose id is likewise unknown.
  it("stays silent for a social frame that identifies no target", async () => {
    await renderAndHydrate();
    await deliver({ domain: "social", event: "POST_CREATED", author_name: "判官" });

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // The direct fix (listing `currentUserId` in the dependency arrays) must not
  // buy the toast at the price of tearing the socket down. `currentUserId` is
  // a primitive derived from `user`, which the connect effect already depends
  // on, so no rebuild may be added beyond the ones `user` itself causes.
  it("opens no extra socket to learn the id", async () => {
    await renderAndHydrate();
    const openedByHydration = FakeWebSocket.instances.length;

    await deliver(follow(String(VIEWER_ID)));

    expect(FakeWebSocket.instances.length).toBe(openedByHydration);
    expect(openedByHydration).toBeLessThanOrEqual(2);
  });
});
