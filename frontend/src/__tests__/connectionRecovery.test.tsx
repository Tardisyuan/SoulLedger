/**
 * A terminal WebSocket state has to offer a way out of itself.
 *
 * `WSClient` stops retrying once its budget is spent, and does not retry at
 * all after a 4001 (auth) close. Either way `status` becomes `"failed"` and
 * stays there for the life of the page. `ConnectionStatus` rendered a red dot
 * and the hardcoded English word "Failed", and offered nothing — while
 * `WebSocketContext` had been exporting `reconnect()` the whole time. The only
 * recovery an operator had was to guess that a page reload would help, on a
 * screen whose entire realtime layer had quietly stopped.
 *
 * The other two defects in the same 60 lines, both asserted below: every label
 * was hardcoded English in an app that ships three bundles, and the dots were
 * raw `bg-emerald-500` / `bg-yellow-500` / `bg-red-500`, so they rendered the
 * same colour in both themes while everything around them changed.
 */
import { act, render, renderHook, screen, fireEvent } from "@testing-library/react";

import { ConnectionBanner, ConnectionStatus, useConnectionBannerShown } from "@/src/components/connection-status";

const mockReconnect = jest.fn();
let mockStatus = "connected";

jest.mock("@/src/contexts/WebSocketContext", () => ({
  useWebSocket: () => ({ status: mockStatus, reconnect: mockReconnect }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "yama" } }),
}));

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ locale: "en", hydrated: true }));

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = "connected";
});

describe("the connection indicator", () => {
  it("offers a way back when the socket has given up", () => {
    mockStatus = "failed";
    render(<ConnectionStatus />);

    fireEvent.click(screen.getByRole("button", { name: "connection.retry" }));

    expect(mockReconnect).toHaveBeenCalledTimes(1);
  });

  it("offers it from disconnected too, the other terminal state", () => {
    mockStatus = "disconnected";
    render(<ConnectionStatus />);

    expect(screen.getByRole("button", { name: "connection.retry" })).toBeInTheDocument();
  });

  it("does not offer it while the client is still trying on its own", () => {
    // A retry button during automatic reconnection invites the operator to
    // fight the backoff.
    for (const status of ["connected", "connecting", "reconnecting"]) {
      mockStatus = status;
      const { unmount } = render(<ConnectionStatus />);
      expect(screen.queryByRole("button", { name: "connection.retry" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("announces the state rather than leaving it to a coloured dot", () => {
    mockStatus = "failed";
    render(<ConnectionStatus />);

    // The dot is aria-hidden; without role="status" the link dropping is
    // invisible to a screen reader.
    expect(screen.getByRole("status")).toHaveTextContent("connection.failed");
  });

  it("takes every label from the bundles, not from the source", () => {
    // `t` is stubbed as identity here, so a hardcoded string would show up as
    // itself. All five labels were hardcoded English before this.
    for (const [status, key] of [
      ["connected", "connection.connected"],
      ["connecting", "connection.connecting"],
      ["reconnecting", "connection.reconnecting"],
      ["disconnected", "connection.disconnected"],
      ["failed", "connection.failed"],
    ] as const) {
      mockStatus = status;
      const { unmount } = render(<ConnectionStatus />);
      expect(screen.getByRole("status")).toHaveTextContent(key);
      unmount();
    }
  });

  it("paints the dot from status tokens, so it follows the theme", () => {
    mockStatus = "failed";
    const { container } = render(<ConnectionStatus />);

    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).toHaveStyle({ backgroundColor: "oklch(var(--color-status-error))" });
    // Assert the absence too: a raw palette class here is exactly what made
    // these three dots theme-blind.
    expect(dot?.className).not.toMatch(/bg-(red|emerald|yellow|green)-\d{3}/);
  });

  it("renders nothing at all when nobody is signed in", () => {
    mockStatus = "failed";
    jest.spyOn(require("@/src/contexts/TenantContext"), "useTenant").mockReturnValue({ user: null });
    const { container } = render(<ConnectionStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the connection pill (v4 第八批第 4 条: in the toolbar, a 2px rule on its lower edge)", () => {
  // The signed-out case above spies useTenant to null; clearAllMocks does not undo a spy.
  beforeEach(() => jest.restoreAllMocks());
  afterEach(() => jest.useRealTimers());

  const classes = (el: Element) => el.className.split(/\s+/);

  it("is a pill in the toolbar's row on desktop — not a bar fixed across the top of the viewport", () => {
    mockStatus = "failed";
    render(<ConnectionBanner />);
    const pill = screen.getByTestId("connection-banner");
    expect(pill).toHaveAttribute("role", "status");
    expect(pill).toHaveAttribute("aria-live", "polite");
    expect(classes(pill)).toEqual(expect.arrayContaining(["inline-flex", "h-7.5", "rounded-[9999px]"]));
    // Absence: Design E 组's 28px bar (fixed, full width, top of the viewport) is gone on desktop. The only
    // `fixed` left is the ≤ 768 float.
    expect(classes(pill).filter((c) => /^(fixed|inset-x-0|top-0|h-7|absolute)$/.test(c))).toEqual([]);
    expect(classes(pill)).toEqual(expect.arrayContaining(["max-[768px]:fixed", "max-[768px]:left-1/2", "max-[768px]:-translate-x-1/2"]));
  });

  it("draws the 2px rule absolutely, so the toolbar keeps its 52px and nothing below it moves", () => {
    mockStatus = "reconnecting";
    render(<ConnectionBanner />);
    const rule = screen.getByTestId("connection-rule");
    expect(classes(rule)).toEqual(expect.arrayContaining(["absolute", "inset-x-0", "h-0.5", "max-[768px]:hidden", "bg-[oklch(var(--color-warn))]"]));
  });

  it.each([
    ["reconnecting", "warn", "--color-warn", false],
    ["failed", "neg", "--color-danger", true],
    ["disconnected", "neg", "--color-danger", true],
  ] as const)("%s: tone %s, dot and rule in %s, retry %s", (status, tone, token, retry) => {
    mockStatus = status;
    render(<ConnectionBanner />);
    const pill = screen.getByTestId("connection-banner");
    expect(pill).toHaveAttribute("data-tone", tone);
    expect(pill).toHaveTextContent(`connection.${status}`);
    expect(classes(screen.getByTestId("connection-rule"))).toContain(`bg-[oklch(var(${token}))]`);
    if (retry) {
      fireEvent.click(screen.getByRole("button", { name: "connection.retry" }));
      expect(mockReconnect).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.queryByRole("button")).toBeNull();
    }
  });

  it("the amber is a mark, never the words: the reason is ink", () => {
    mockStatus = "reconnecting";
    render(<ConnectionBanner />);
    const pill = screen.getByTestId("connection-banner");
    expect(classes(pill)).toContain("text-[oklch(var(--color-ink))]");
    expect(pill.className).not.toMatch(/text-\[oklch\(var\(--color-(warn|warning)\)\)\]/);
  });

  it("fades out over 300ms once connected, and does not say 「已连接」", () => {
    jest.useFakeTimers();
    mockStatus = "failed";
    const { rerender } = render(<ConnectionBanner />);
    mockStatus = "connected";
    rerender(<ConnectionBanner />);
    const pill = screen.getByTestId("connection-banner");
    expect(classes(pill)).toContain("opacity-0");
    expect(pill).not.toHaveTextContent("connection.connected");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  describe("离线(v3:navigator.onLine === false,随 offline / online 事件)", () => {
    const setOnline = (on: boolean) => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => on });
      act(() => {
        window.dispatchEvent(new Event(on ? "online" : "offline"));
      });
    };
    afterEach(() => setOnline(true));

    it("socket 连着也出胶囊:离线 · 当前内容可能不是最新版本,灰点,没有按钮", () => {
      jest.useFakeTimers();
      mockStatus = "connected";
      render(<ConnectionBanner />);
      expect(screen.queryByTestId("connection-banner")).toBeNull();

      setOnline(false);
      const pill = screen.getByTestId("connection-banner");
      expect(pill).toHaveTextContent("connection.offline");
      // Absence: the socket reason is not what an offline pill says.
      expect(pill).not.toHaveTextContent("connection.connected");
      expect(pill).toHaveAttribute("data-tone", "offline");
      expect(classes(screen.getByTestId("connection-rule"))).toContain("bg-[oklch(var(--color-faint-text))]");
      // Design 第八批: offline has no button — queries refetch on `online`; a socket that gave up shows 重连 then.
      expect(screen.queryByRole("button")).toBeNull();

      setOnline(true);
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.queryByTestId("connection-banner")).toBeNull();
    });

    it("the shell's hook says the same as the pill", () => {
      mockStatus = "connected";
      const { result } = renderHook(() => useConnectionBannerShown());
      expect(result.current).toBe(false);
      setOnline(false);
      expect(result.current).toBe(true);
    });
  });

  it("is not there while connected or still connecting", () => {
    for (const s of ["connected", "connecting"]) {
      mockStatus = s;
      const { container, unmount } = render(<ConnectionBanner />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
