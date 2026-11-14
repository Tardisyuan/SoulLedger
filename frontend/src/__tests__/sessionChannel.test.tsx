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
import { SESSION_CHANNEL, announceSession, onSessionMessage, resetSessionChannelForTests } from "@/src/lib/sessionChannel";
import { LAST_USERNAME_KEY, readLastAccount, settleLastUsername } from "@/src/lib/lastUsername";

jest.mock("@soulledger/core/api", () => ({ permApi: { myRolePermissions: jest.fn() } }));

class FakeChannel {
  static open: FakeChannel[] = [];
  static posted: unknown[] = [];
  onmessage: ((_event: MessageEvent) => void) | null = null;
  listeners = new Set<(_event: MessageEvent) => void>();
  closed = false;
  name: string;
  constructor(channelName: string) {
    this.name = channelName;
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown) {
    FakeChannel.posted.push(data);
    for (const other of FakeChannel.open) {
      if (other !== this && !other.closed && other.name === this.name) {
        other.onmessage?.({ data } as MessageEvent);
        for (const l of other.listeners) l({ data } as MessageEvent);
      }
    }
  }
  addEventListener(_type: "message", l: (_event: MessageEvent) => void) {
    this.listeners.add(l);
  }
  removeEventListener(_type: "message", l: (_event: MessageEvent) => void) {
    this.listeners.delete(l);
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
    resetSessionChannelForTests();
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
    resetSessionChannelForTests();
    FakeChannel.open = [];
    FakeChannel.posted = [];
    g.BroadcastChannel = FakeChannel;
  });
  afterEach(() => {
    if (saved === undefined) delete g.BroadcastChannel;
    else g.BroadcastChannel = saved;
  });

  it("sends only the bare word, to the other tabs and never back to this page", () => {
    // 2026-11-15 E2E: with a channel object per call, this page's own listener heard the login page's
    // 「signed-in」 and dropped the token it had just received. One object per page is what keeps it out.
    const here: string[] = [];
    const elsewhere: string[] = [];
    onSessionMessage((m) => here.push(m));
    const otherTab = new FakeChannel(SESSION_CHANNEL);
    otherTab.onmessage = (e) => elsewhere.push(e.data as string);
    announceSession("signed-in");
    announceSession("signed-out");
    expect(elsewhere).toEqual(["signed-in", "signed-out"]);
    expect(here).toEqual([]);
    expect(FakeChannel.posted).toEqual(["signed-in", "signed-out"]); // no token, no user: strings only
  });

  it("hears other tabs, and stops hearing them once unsubscribed", () => {
    const heard: string[] = [];
    const off = onSessionMessage((m) => heard.push(m));
    fromAnotherTab("signed-out");
    off();
    fromAnotherTab("signed-in");
    expect(heard).toEqual(["signed-out"]);
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
      expect(FakeChannel.open[0]?.listeners.size ?? 0).toBe(0);
    });
  });
});

describe("lastUsername (W3; Design 第五十二批 F4)", () => {
  it("keeps the name and the display name only with 保持登录, and an unticked sign-in forgets it", () => {
    settleLastUsername("yama", false, "阎罗");
    expect(readLastAccount()).toBeNull();
    settleLastUsername("yama", true, "阎罗");
    expect(JSON.parse(localStorage.getItem(LAST_USERNAME_KEY)!)).toEqual({ username: "yama", display_name: "阎罗" });
    expect(readLastAccount()).toEqual({ username: "yama", display_name: "阎罗" });
    settleLastUsername("yama", false);
    expect(readLastAccount()).toBeNull();
  });

  it("reads W3's plain string and stores it in the new shape; a blank or nameless entry is nothing", () => {
    localStorage.setItem(LAST_USERNAME_KEY, "yama");
    expect(readLastAccount()).toEqual({ username: "yama", display_name: "" });
    expect(JSON.parse(localStorage.getItem(LAST_USERNAME_KEY)!)).toEqual({ username: "yama", display_name: "" });
    localStorage.setItem(LAST_USERNAME_KEY, "12345");
    expect(readLastAccount()).toEqual({ username: "12345", display_name: "" });
    localStorage.setItem(LAST_USERNAME_KEY, JSON.stringify({ display_name: "x" }));
    expect(readLastAccount()).toBeNull();
    localStorage.setItem(LAST_USERNAME_KEY, "  ");
    expect(readLastAccount()).toBeNull();
  });

  it("explicit sign-out keeps it: the sign-in page still shows the card (F4)", async () => {
    settleLastUsername("yama", true, "阎罗");
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(TenantProvider, null, children);
    (permApi.myRolePermissions as jest.Mock).mockResolvedValue({ data: { role: "JUDGE", permissions: [] } });
    const { result } = renderHook(() => useTenant(), { wrapper });
    act(() => result.current.logout());
    expect(readLastAccount()).toEqual({ username: "yama", display_name: "阎罗" });
  });
});
