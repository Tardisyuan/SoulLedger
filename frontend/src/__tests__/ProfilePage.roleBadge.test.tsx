/**
 * /profile's role badge is neutral (v3: danger only for errors, warning only for reversible risk).
 * It used to be ADMIN = error red, JUDGE = warning amber, GUARDIAN = info — a role read as an alert.
 * The users list and the actors roster already draw roles neutral; this is the same decision.
 */
import { screen } from "@testing-library/react";
import ProfilePage from "@/app/profile/page";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  authApi: {
    profile: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    preferences: jest.fn().mockResolvedValue({ data: { notifications: {} } }),
    updatePreferences: jest.fn(),
  },
  notificationsApi: { emailStatus: jest.fn().mockResolvedValue({ data: { last_failure: null } }) },
  sessionsApi: { list: jest.fn().mockResolvedValue({ data: [] }) },
  mfaApi: { status: jest.fn().mockResolvedValue({ data: { enabled: false, required: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 } }) },
}));

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ locale: "zh-Hans", hydrated: true }));

let mockRole = "ADMIN";
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { username: "u", role: mockRole, tenant: { display_name: "中国地府" } }, setUser: jest.fn() }),
}));

jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const { authApi } = require("@soulledger/core/api");

function renderPage() {
  return renderWithProviders(<ProfilePage />, { i18n: false });
}

it.each(["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"])("%s: the role badge is neutral ink, no feedback colour", async (role) => {
  mockRole = role;
  (authApi.profile as jest.Mock).mockResolvedValue({ data: { username: "u", email: "", role } });
  renderPage();
  const badge = await screen.findByText(`users.roles.${role}`);
  expect(badge.className).toContain("text-[oklch(var(--color-ink-muted))]");
  expect(badge.className).not.toMatch(/--color-(danger|warning|success|accent)\b/);
});
