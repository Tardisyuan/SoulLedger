/**
 * W4 多标签页同步 (`src/lib/sessionChannel.ts`) and W3's sign-out half (`TenantContext.logout`).
 *
 * jsdom has no BroadcastChannel, which is the first thing pinned: without one every call is a no-op and
 * nothing throws. The rest installs a small in-memory stand-in with the one property the code relies on —
 * a message reaches every OTHER channel of the same name, never its sender.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { permApi } from "@soulledger/core/api";
import { getAccessToken, setAccessToken } from "@soulledger/core/platform";
import { TenantProvider, useTenant } from "@/src/contexts/TenantContext";
import { SESSION_CHANNEL, announceSession, onSessionMessage } from "@/src/lib/sessionChannel";
import { LAST_USERNAME_KEY, readLastUsername, settleLastUsername } from "@/src/lib/lastUsername";

jest.mock("@soulledger/core/api", () => ({ permApi: { myRolePermissions: jest.fn() } }));

class FakeChannel {
  static open: FakeChannel[] = [];
  static posted: unknown[] = [];
  onmessage: ((_event: MessageEvent) => void) | null = null;
  closed = false;
  name: string;
  constructor(channelName: string) {
    this.name = channelName;
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown) {
    FakeChannel.posted.push(data);
    for (const other of FakeChannel.open) {
      if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    this.closed = true;
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this);
  }
}

/** Another tab of the same browser saying something. */
const fromAnotherTab = (data: unknown) => new FakeChannel(SESSION_CHANNEL).postMessage(data);

describe("sessionChannel without BroadcastChannel (jsdom, old browsers)", () => {
  it("does nothing and throws nothing", () => {
    const g = globalThis as { BroadcastChannel?: unknown };
    const saved = g.BroadcastChannel;
    delete g.BroadcastChannel;
    try {
      expect(() => announceSession("signed-out")).not.toThrow();
      const off = onSessionMessage(() => {});
      expect(() => off()).not.toThrow();
    } finally {
      if (saved !== undefined) g.BroadcastChannel = saved;
    }
  });
});

describe("sessionChannel", () => {
  const g = globalThis as { BroadcastChannel?: unknown };
  const saved = g.BroadcastChannel;
  beforeEach(() => {
    FakeChannel.open = [];
    FakeChannel.posted = [];
    g.BroadcastChannel = FakeChannel;
  });
  afterEach(() => {
    if (saved === undefined) delete g.BroadcastChannel;
    else g.BroadcastChannel = saved;
  });

  it("sends only the bare word on the soulledger_session channel, and closes what it opened", () => {
    const heard: string[] = [];
    const off = onSessionMessage((m) => heard.push(m));
    announceSession("signed-in");
    announceSession("signed-out");
    expect(heard).toEqual(["signed-in", "signed-out"]);
    expect(FakeChannel.posted).toEqual(["signed-in", "signed-out"]); // no token, no user: strings only
    off();
    expect(FakeChannel.open).toEqual([]);
  });

  it("ignores anything that is not one of the two words", () => {
    const heard: string[] = [];
    onSessionMessage((m) => heard.push(m));
    fromAnotherTab({ type: "signed-out" });
    fromAnotherTab("refresh-me");
    expect(heard).toEqual([]);
  });

  describe("a tab under TenantProvider", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(TenantProvider, null, children);

    beforeEach(() => {
      (permApi.myRolePermissions as jest.Mock).mockResolvedValue({ data: { role: "JUDGE", permissions: [] } });
      sessionStorage.clear();
      window.history.pushState({}, "", "/login"); // on the way in already: no navigation to assert around
    });
    afterEach(() => window.history.pushState({}, "", "/"));

    it("drops its own session when another tab signs out", async () => {
      localStorage.setItem(
        "soulledger_user",
        JSON.stringify({ user: { id: 1, username: "judge1", role: "JUDGE", tenant: null }, storedAt: Date.now() })
      );
      setAccessToken("LIVE-BEARER");
      const { result } = renderHook(() => useTenant(), { wrapper });
      await waitFor(() => expect(result.current.user).not.toBeNull());
      expect(getAccessToken()).toBe("LIVE-BEARER");

      act(() => fromAnotherTab("signed-out"));

      expect(result.current.user).toBeNull();
      expect(getAccessToken()).toBeNull();
    });

    it("stops listening when unmounted", () => {
      const { unmount } = renderHook(() => useTenant(), { wrapper });
      expect(FakeChannel.open).toHaveLength(1);
      unmount();
      expect(FakeChannel.open).toEqual([]);
    });
  });
});

describe("lastUsername (W3)", () => {
  it("keeps the name only with 保持登录, and an unticked sign-in forgets it", () => {
    settleLastUsername("yama", false);
    expect(readLastUsername()).toBeNull();
    settleLastUsername("yama", true);
    expect(localStorage.getItem(LAST_USERNAME_KEY)).toBe("yama");
    settleLastUsername("yama", false);
    expect(readLastUsername()).toBeNull();
  });

  it("explicit sign-out forgets it", async () => {
    settleLastUsername("yama", true);
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(TenantProvider, null, children);
    (permApi.myRolePermissions as jest.Mock).mockResolvedValue({ data: { role: "JUDGE", permissions: [] } });
    const { result } = renderHook(() => useTenant(), { wrapper });
    act(() => result.current.logout());
    expect(readLastUsername()).toBeNull();
  });
});
