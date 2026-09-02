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
import { render, screen, fireEvent } from "@testing-library/react";

import { ConnectionStatus } from "@/src/components/connection-status";

const mockReconnect = jest.fn();
let mockStatus = "connected";

jest.mock("@/src/contexts/WebSocketContext", () => ({
  useWebSocket: () => ({ status: mockStatus, reconnect: mockReconnect }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "yama" } }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

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
    expect(dot).toHaveStyle({ backgroundColor: "hsl(var(--color-status-error))" });
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
