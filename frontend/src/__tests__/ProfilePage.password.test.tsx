/**
 * /profile 修改密码: a success says the other devices were signed out.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProfilePage from "@/app/profile/page";

jest.mock("@soulledger/core/api", () => ({
  authApi: {
    profile: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    preferences: jest.fn().mockResolvedValue({ data: { email_notifications: false } }),
    updatePreferences: jest.fn(),
  },
  notificationsApi: { emailStatus: jest.fn().mockResolvedValue({ data: { last_failure: null } }) },
  mfaApi: { status: jest.fn().mockResolvedValue({ data: { enabled: false, required: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 } }) },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { username: "u", role: "JUDGE", tenant: { display_name: "中国地府" } }, setUser: jest.fn() }),
}));
const mockToast = jest.fn();
jest.mock("@/src/components/ui/Toast", () => ({ showToast: (...a: unknown[]) => mockToast(...a) }));

const { authApi } = require("@soulledger/core/api");

async function openForm() {
  (authApi.profile as jest.Mock).mockResolvedValue({ data: { username: "u", email: "", role: "JUDGE" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>
  );
  fireEvent.click((await screen.findAllByRole("button", { name: "profile.change_password" }))[0]);
  const [oldInput, newInput, confirmInput] = Array.from(document.querySelectorAll('input[type="password"]'));
  fireEvent.change(oldInput, { target: { value: "oldpw-123" } });
  fireEvent.change(newInput, { target: { value: "12345678" } });
  fireEvent.change(confirmInput, { target: { value: "12345678" } });
  fireEvent.submit(oldInput.closest("form")!);
}

beforeEach(() => jest.clearAllMocks());

it("a success says the other devices were signed out", async () => {
  (authApi.changePassword as jest.Mock).mockResolvedValue({ data: { detail: "ok", access: "a", refresh: "r" } });
  await openForm();
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("profile.password_changed_others_out", "success"));
});
