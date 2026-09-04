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
import { render, act, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantProvider, useTenant } from "@/src/contexts/TenantContext";
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

// `TenantProvider` refetches permissions on rehydration.
//
// THE RESPONSE CARRIES A MARKER, and that is not decoration. `TenantProvider`
// hydrates in TWO steps — see `HydrationProbe` below — and its first step sets
// `permissions: []`. A stub that also answered `[]` made the two steps
// **indistinguishable from outside**, so nothing in this file could wait for
// the second one. That is the whole of the flake fixed here.
const HYDRATED_PERMISSION = "social.read";

jest.mock("@soulledger/core/api", () => ({
  permApi: {
    myRolePermissions: jest.fn(() =>
      Promise.resolve({ data: { permissions: ["social.read"], role: "VIEWER" } }),
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
 * Publishes the permission list, so a test can wait for the SECOND half of
 * hydration rather than the first.
 */
function HydrationProbe() {
  const { user } = useTenant();
  return <span data-testid="perms">{(user?.permissions ?? []).join(",")}</span>;
}

/**
 * Renders the provider pair and waits for hydration to COMPLETE — both halves.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE OLD WAIT WAS WRONG, AND WHAT IT COST.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This used to wait for the first socket and say, in this very comment, that
 * "its arrival IS the proof that hydration has completed". **That sentence was
 * false.** `TenantProvider` hydrates in two steps
 * (`src/contexts/TenantContext.tsx:161-165`):
 *
 *   1. synchronously in the mount effect — `setUserState({...cached, permissions: []})`
 *   2. after `permApi.myRolePermissions()` resolves — `setUserState(prev => ({...prev, permissions, role}))`
 *
 * Step 2 produces a **new object identity** for `user`, and `WebSocketProvider`'s
 * connect effect lists `user` in its dependencies — so step 2 tears the socket
 * down and opens another one. Hydration therefore costs TWO sockets, and the
 * first one satisfied the old wait.
 *
 * Whether step 2 had landed by the time this helper returned depended on
 * whether its promise callback ran before the last `act` here closed. Under a
 * loaded full-suite run it sometimes did not — and then the second socket was
 * created inside `deliver()`, which is where "opens no extra socket to learn
 * the id" saw `Expected: 1, Received: 2` on 2026-09-05. Eight consecutive
 * clean full runs afterwards; the race window is small and load-dependent,
 * which is exactly why the reproduction below is deterministic instead.
 *
 * Waiting on the permission marker is waiting on step 2's state having been
 * applied and its effects flushed — `waitFor` wraps its polls in `act`. So the
 * socket count is settled before any test looks at it.
 */
async function renderAndHydrate() {
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <WebSocketProvider>
          <HydrationProbe />
        </WebSocketProvider>
      </TenantProvider>
    </QueryClientProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("perms")).toHaveTextContent(HYDRATED_PERMISSION),
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
  /**
   * `renderAndHydrate` refuses to return on a half-hydrated tree.
   *
   * THIS IS THE ONE THAT PINS THE FIX, and it needs its own test because
   * nothing else can. The wait added to `renderAndHydrate` only changes the
   * outcome when the permissions response is LATE — and in an isolated run it
   * never is, which is exactly why the flake needed a loaded full suite to
   * appear once in nine runs. Deleting the wait leaves every other test in
   * this file green.
   *
   * So lateness is supplied rather than waited for: the response is held open,
   * and the helper must then time out instead of proceeding. Without the wait
   * it proceeds — which is the state the 2026-09-05 failure was taken in.
   *
   * Costs one `waitFor` timeout (1s). That is the price of the only assertion
   * that can tell the fix from its absence.
   */
  it("hydration 没走完时,renderAndHydrate 拒绝返回", async () => {
    const { permApi } = require("@soulledger/core/api");
    let resolvePerms: (_v: unknown) => void = () => {};
    (permApi.myRolePermissions as jest.Mock).mockImplementationOnce(
      () => new Promise((r) => { resolvePerms = r; }),
    );

    await expect(renderAndHydrate()).rejects.toThrow();

    // 收尾:把挂起的 promise 放掉,免得它跨测试留在事件循环里。
    await act(async () => {
      resolvePerms({ data: { permissions: [HYDRATED_PERMISSION], role: "VIEWER" } });
    });
  });

  /**
   * Hydration costs two sockets, and the second one is the permissions
   * response — not anything a frame does later.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * THIS IS THE FLAKE FROM 2026-09-05, MADE DETERMINISTIC.
   * ─────────────────────────────────────────────────────────────────────────
   *
   * That day "opens no extra socket to learn the id" failed once in a full
   * run with `Expected: 1, Received: 2`, then passed eight consecutive full
   * runs. The count was never random: `renderAndHydrate` waited for the FIRST
   * socket, and whether the second had been created by the time it returned
   * depended on whether the permissions promise callback ran before the last
   * `act` closed. Under load it sometimes did not, and the second socket was
   * then created inside `deliver()` — one after the snapshot.
   *
   * Holding the response open puts that window under this test's control
   * instead of the scheduler's, so the same fact is checked without the race.
   * Written as the honest assertion (two sockets, both from hydration) rather
   * than the one the flaky test implied (one).
   */
  it("权限响应恰好换一次 socket,而且那次属于 hydration", async () => {
    const { permApi } = require("@soulledger/core/api");
    let resolvePerms: (_v: unknown) => void = () => {};
    (permApi.myRolePermissions as jest.Mock).mockImplementationOnce(
      () => new Promise((r) => { resolvePerms = r; }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <WebSocketProvider>
            <HydrationProbe />
          </WebSocketProvider>
        </TenantProvider>
      </QueryClientProvider>,
    );

    // 第一段:缓存里的用户已恢复,权限还空着,连接 effect 已经开了一个 socket。
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    expect(screen.getByTestId("perms")).toHaveTextContent("");
    await act(async () => { lastSocket().open(); });

    // 第二段:权限落地。`setUserState(prev => ({...prev, …}))` 换了对象身份,
    // 而连接 effect 依赖 `user` —— 所以这一次**必然**换一个 socket。
    await act(async () => {
      resolvePerms({ data: { permissions: [HYDRATED_PERMISSION], role: "VIEWER" } });
    });
    await waitFor(() =>
      expect(screen.getByTestId("perms")).toHaveTextContent(HYDRATED_PERMISSION),
    );
    expect(FakeWebSocket.instances.length).toBe(2);

    // 而这就是全部。此后收帧一个都不加 —— 那正是「opens no extra socket」
    // 想说的话,只是它此前是在一个还没结束的 hydration 上说的。
    await act(async () => { lastSocket().open(); });
    await deliver(follow(String(VIEWER_ID)));
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("opens no extra socket to learn the id", async () => {
    await renderAndHydrate();
    const openedByHydration = FakeWebSocket.instances.length;

    await deliver(follow(String(VIEWER_ID)));

    expect(FakeWebSocket.instances.length).toBe(openedByHydration);
    // EXACTLY two, not "at most two". `toBeLessThanOrEqual(2)` was true with
    // ZERO margin — hydration has always opened exactly two — so it read as a
    // tolerance while being an equality, and it could not distinguish "the
    // second socket is part of hydration" from "the second socket arrived
    // late". Now the wait makes the number settled, so the number is stated:
    // one socket per `setUserState` in `TenantProvider`'s two-step hydration.
    // A third would mean a new rebuild; a first alone would mean the
    // permissions step stopped changing `user`'s identity, and the test above
    // is the one that says why that matters.
    expect(openedByHydration).toBe(2);
  });
});
