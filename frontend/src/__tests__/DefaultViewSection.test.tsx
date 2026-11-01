/**
 * review-2026-11-01 Web 1: the 默认视图 setting is reachable from /profile, not only from the
 * one-time setup — and an officer who never chose sees the queue checked, because that is
 * where login now takes them.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DefaultViewSection } from "@/src/components/profile/DefaultViewSection";

jest.mock("@soulledger/core/api", () => ({
  authApi: { preferences: jest.fn(), updatePreferences: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
let mockUser: { role: string; permissions: string[] } = { role: "JUDGE", permissions: ["judgment.read"] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const { authApi } = require("@soulledger/core/api");

beforeEach(() => {
  jest.clearAllMocks();
  authApi.preferences.mockResolvedValue({ data: { default_view: null } });
  authApi.updatePreferences.mockImplementation(async (body: object) => ({ data: body }));
});

it("an officer who never chose: the queue is checked and the line says it follows the role", async () => {
  mockUser = { role: "JUDGE", permissions: ["judgment.read"] };
  render(<DefaultViewSection />);
  await waitFor(() => expect(authApi.preferences).toHaveBeenCalled());
  expect(screen.getByTestId("profile-view-operator")).toBeChecked();
  expect(screen.getByTestId("profile-view-admin")).not.toBeChecked();
  expect(screen.getByTestId("profile-view-unset")).toBeInTheDocument();
});

it("an admin who never chose: the dashboard is checked", async () => {
  mockUser = { role: "ADMIN", permissions: [] };
  render(<DefaultViewSection />);
  await waitFor(() => expect(authApi.preferences).toHaveBeenCalled());
  expect(screen.getByTestId("profile-view-admin")).toBeChecked();
  expect(screen.getByTestId("profile-view-operator")).not.toBeChecked();
});

it("choosing saves to the server, and the 'unset' line goes away", async () => {
  mockUser = { role: "JUDGE", permissions: ["judgment.read"] };
  render(<DefaultViewSection />);
  await waitFor(() => expect(authApi.preferences).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId("profile-view-admin"));
  expect(authApi.updatePreferences).toHaveBeenCalledWith({ default_view: "admin" });
  await waitFor(() => expect(screen.getByTestId("profile-view-admin")).toBeChecked());
  expect(screen.queryByTestId("profile-view-unset")).toBeNull();
});
