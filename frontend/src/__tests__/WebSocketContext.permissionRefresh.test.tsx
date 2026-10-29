/**
 * The server's `permission.refreshed` push re-reads this user's permissions (2026-10-29 decision 10).
 *
 * The backend now sends that frame on its own after a demotion or a grant change of the user's role
 * (`apps/events/realtime.py::push_permission_refresh`). Its gate moves server-side; the pages gate on the
 * permissions in `TenantContext`, so the provider must hand the frame to `refreshFromServer`. Asserted
 * both ways: the push calls it, an ordinary notification does not.
 */
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebSocketProvider } from "@/src/contexts/WebSocketContext";

import { installWsHarness, lastSocket } from "./support/wsHarness";

const mockRefresh = jest.fn();
const mockUser = { id: 1, username: "yama" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser, refreshFromServer: mockRefresh }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

installWsHarness();

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WebSocketProvider>
        <span />
      </WebSocketProvider>
    </QueryClientProvider>
  );
  act(() => lastSocket().open());
}

beforeEach(() => mockRefresh.mockClear());

it("a pushed permission.refreshed re-reads the permissions", () => {
  mount();
  act(() => lastSocket().receive({ type: "permission.refreshed", permissions: ["soul.read"] }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("other frames do not", () => {
  mount();
  act(() => lastSocket().receive({ type: "pong" }));
  act(() => lastSocket().receive({ type: "notification", notification: { id: 1 } }));
  expect(mockRefresh).not.toHaveBeenCalled();
});
