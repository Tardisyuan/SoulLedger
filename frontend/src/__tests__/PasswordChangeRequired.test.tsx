/**
 * 密码须先改(首次登录 / 管理员重置 / 超期): 别的页面被带去 /profile; /profile 只剩改密码一节并说明原因,
 * 没有取消;改好后清掉标记。管理员的新密码至少 12 位,清单上写的也是 12。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProfilePage from "@/app/profile/page";
import { PasswordChangeRedirect } from "@/src/components/layout/PasswordChangeRedirect";

const mockReplace = jest.fn();
let mockPath = "/souls";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => mockPath,
}));

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
  mfaApi: { status: jest.fn().mockResolvedValue({ data: {} }) },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));
let mockUser: Record<string, unknown>;
const mockSetUser = jest.fn();
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser, setUser: mockSetUser }),
}));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const { authApi } = require("@soulledger/core/api");

function renderProfile(owed = true) {
  (authApi.profile as jest.Mock).mockResolvedValue({ data: { username: "u", email: "", role: mockUser.role, password_change_required: owed } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProfilePage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/souls";
  mockUser = { username: "u", role: "JUDGE", tenant: null, password_change_required: true };
});

describe("PasswordChangeRedirect", () => {
  it("sends every other page to /profile", () => {
    render(<PasswordChangeRedirect />);
    expect(mockReplace).toHaveBeenCalledWith("/profile");
  });

  it("leaves /profile alone, and leaves an officer who owes nothing alone", () => {
    mockPath = "/profile";
    render(<PasswordChangeRedirect />);
    mockPath = "/souls";
    mockUser = { ...mockUser, password_change_required: false };
    render(<PasswordChangeRedirect />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("the profile page while the password is owed", () => {
  it("shows the reason and the form, with no cancel and none of the sections that would 403", async () => {
    renderProfile();
    expect(await screen.findByTestId("password-must-change")).toHaveTextContent("profile.password_must_change");
    await waitFor(() => expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "common.cancel" })).not.toBeInTheDocument();
    expect(screen.queryByText("mfa.title")).not.toBeInTheDocument();
    expect(screen.queryByText("profile.devices.title")).not.toBeInTheDocument();
  });

  it("a successful change clears the flag", async () => {
    (authApi.changePassword as jest.Mock).mockResolvedValue({ data: { detail: "ok" } });
    renderProfile();
    await waitFor(() => expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3));
    const [oldInput, newInput, confirmInput] = Array.from(document.querySelectorAll('input[type="password"]'));
    fireEvent.change(oldInput, { target: { value: "oldpw-123" } });
    fireEvent.change(newInput, { target: { value: "N0t-Guessable!2026" } });
    fireEvent.change(confirmInput, { target: { value: "N0t-Guessable!2026" } });
    fireEvent.submit(oldInput.closest("form")!);
    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith({ ...mockUser, password_change_required: false }));
  });

  it("an officer who owes nothing keeps the Cancel button and the other sections", async () => {
    mockUser = { ...mockUser, password_change_required: false };
    renderProfile(false);
    fireEvent.click((await screen.findAllByRole("button", { name: "profile.change_password" }))[0]);
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeInTheDocument();
    expect(screen.queryByTestId("password-must-change")).not.toBeInTheDocument();
    expect(screen.getByText("mfa.title")).toBeInTheDocument();
  });

  it("the checklist for an administrator asks for 12", async () => {
    mockUser = { ...mockUser, role: "ADMIN" };
    renderProfile();
    await waitFor(() => expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3));
    expect(screen.getByTestId("password-rule-min_length")).toHaveTextContent("password_rules.min_length_admin");
    const newInput = document.querySelectorAll('input[type="password"]')[1];
    fireEvent.change(newInput, { target: { value: "Abcdefgh-12" } }); // 11
    expect(screen.getByTestId("password-rule-min_length").getAttribute("data-state")).toBe("idle");
    fireEvent.change(newInput, { target: { value: "Abcdefgh-123" } }); // 12
    expect(screen.getByTestId("password-rule-min_length").getAttribute("data-state")).toBe("ok");
  });
});
