/**
 * app/(auth)/login/page.tsx after 第三类 D 组 10a. The E2E spec owns the
 * happy path and the empty-submit refusal; this covers what the redesign
 * added: the inline error (replacing the error toast), show / hide password,
 * the statute panel, and login honouring the stored default view.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import LoginPage from "@/app/(auth)/login/page";
import { authApi } from "@soulledger/core/api";
import { LOGIN_STATUTES } from "@/src/lib/loginStatutes";
import { defaultViewRoute } from "@/src/lib/defaultView";

jest.mock("@soulledger/core/api", () => ({ authApi: { login: jest.fn() } }));
jest.mock("@soulledger/core/platform", () => ({ setAccessToken: jest.fn(), setRefreshToken: jest.fn() }));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ setUser: jest.fn() }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: jest.requireActual("@/src/contexts/I18nContext").LOCALE_LABELS,
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true, setLocale: jest.fn() }),
}));

const mockedLogin = authApi.login as jest.Mock;

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/auth\.username/), { target: { value: "nobody" } });
  fireEvent.change(screen.getByLabelText(/auth\.password/), { target: { value: "wrong-password" } });
  fireEvent.click(screen.getByRole("button", { name: "auth.login" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe("LoginPage", () => {
  it("shows bad credentials inline, once, and not as a toast", async () => {
    mockedLogin.mockRejectedValue({
      response: { data: { detail: "No active account found with the given credentials" } },
    });
    render(<LoginPage />);
    fillAndSubmit();

    const alert = await screen.findByTestId("login-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("! auth.error_invalid_credentials");
    // One surface: E2E reads this text with a strict locator.
    expect(screen.getAllByText("auth.error_invalid_credentials")).toHaveLength(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("toggles the password between hidden and shown", () => {
    render(<LoginPage />);
    const input = screen.getByLabelText(/auth\.password/) as HTMLInputElement;
    const toggle = screen.getByRole("button", { name: "soul_app.common.show" });

    expect(input.type).toBe("password");
    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent("soul_app.common.hide");
  });

  it("quotes one statute from the fixed corpus list", () => {
    render(<LoginPage />);
    const quote = screen.getByTestId("login-statute").textContent;
    expect(LOGIN_STATUTES.map((s) => s.text)).toContain(quote);
  });

  it("does not offer a civilization choice — the login request carries no tenant", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

});

// jsdom's `window.location` is non-configurable, so the redirect itself is not
// observable here (E2E asserts /dashboard). What the page assigns is
// `defaultViewRoute()`, and that is what is pinned.
describe("defaultViewRoute", () => {
  beforeEach(() => localStorage.clear());

  it("keeps /dashboard when nothing is stored, or something unknown is", () => {
    expect(defaultViewRoute()).toBe("/dashboard");
    localStorage.setItem("soulledger_default_view", "judge");
    expect(defaultViewRoute()).toBe("/dashboard");
  });

  it("sends 操作员 to the judgment queue", () => {
    localStorage.setItem("soulledger_default_view", "operator");
    expect(defaultViewRoute()).toBe("/judgment/queue");
  });
});
