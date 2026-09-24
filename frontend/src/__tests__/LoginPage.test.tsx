/**
 * app/(auth)/login/page.tsx after 第三类 D 组 10a. The E2E spec owns the
 * happy path and the empty-submit refusal; this covers what the redesign
 * added: the inline error (replacing the error toast), show / hide password,
 * the statute panel, the civilization rows, 保持登录, 忘记密码, and login
 * honouring the server's default view.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LoginPage from "@/app/(auth)/login/page";
import { authApi } from "@soulledger/core/api";
import { LOGIN_STATUTES } from "@/src/lib/loginStatutes";
import { defaultViewRoute } from "@/src/lib/defaultView";

jest.mock("@soulledger/core/api", () => ({
  authApi: {
    login: jest.fn(),
    civilizations: jest.fn(),
    requestPasswordHelp: jest.fn(),
    preferences: jest.fn(),
    updatePreferences: jest.fn(),
  },
}));
jest.mock("@soulledger/core/platform", () => ({ setAccessToken: jest.fn(), setRefreshToken: jest.fn() }));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ setUser: jest.fn() }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: jest.requireActual("@/src/contexts/I18nContext").LOCALE_LABELS,
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    locale: "zh-Hans",
    hydrated: true,
    setLocale: jest.fn(),
  }),
}));

const mockedLogin = authApi.login as jest.Mock;
const mockedCivs = authApi.civilizations as jest.Mock;
const mockedHelp = authApi.requestPasswordHelp as jest.Mock;
const mockedPrefs = authApi.preferences as jest.Mock;
const mockedSavePrefs = authApi.updatePreferences as jest.Mock;

const CIV_ROWS = [
  { code: "CN_DIYU", civilization: "CHINESE" },
  { code: "EU_HEAVEN_HELL", civilization: "EUROPEAN" },
  { code: "EG_DUAT", civilization: "EGYPTIAN" },
  { code: "GR_HADES", civilization: "GREEK" },
];

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/auth\.username/), { target: { value: "nobody" } });
  fireEvent.change(screen.getByLabelText(/auth\.password/), { target: { value: "wrong-password" } });
  fireEvent.click(screen.getByRole("button", { name: "auth.login" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockedCivs.mockResolvedValue({ data: CIV_ROWS });
  mockedPrefs.mockResolvedValue({ data: { default_view: null } });
  mockedSavePrefs.mockImplementation(async (body: object) => ({ data: body }));
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

  it("does not offer a civilization choice — the login request carries no tenant", async () => {
    mockedLogin.mockRejectedValue({ response: { data: {} } });
    render(<LoginPage />);
    await screen.findByTestId("login-civilizations");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    fillAndSubmit();
    await screen.findByTestId("login-error");
    const [body] = mockedLogin.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(["password", "remember", "username"]);
  });

  it("lists the civilizations from the public endpoint and marks this device's last one", async () => {
    localStorage.setItem("soulledger_last_tenant", "EG_DUAT");
    render(<LoginPage />);
    const list = await screen.findByTestId("login-civilizations");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "■organization.civilizations.CHINESE",
      "●organization.civilizations.EUROPEAN",
      "▲organization.civilizations.EGYPTIAN",
      "◆organization.civilizations.GREEK",
    ]);
    expect(rows.filter((r) => r.getAttribute("aria-current") === "true")).toEqual([rows[2]]);
    expect(screen.getByText("auth.civilization_note")).toBeInTheDocument();
  });

  it("leaves the list out when the endpoint fails, and still signs in", async () => {
    mockedCivs.mockRejectedValue(new Error("offline"));
    render(<LoginPage />);
    await waitFor(() => expect(mockedCivs).toHaveBeenCalled());
    expect(screen.queryByTestId("login-civilizations")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "auth.login" })).toBeEnabled();
  });

  it("remembers where this device signed in", async () => {
    mockedLogin.mockResolvedValue({
      data: { access: "A", refresh: "R", user: { id: 1, username: "u", tenant: { code: "GR_HADES", display_name: "x" } } },
    });
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() => expect(localStorage.getItem("soulledger_last_tenant")).toBe("GR_HADES"));
  });

  it("sends remember=false unless 保持登录 is ticked, and true when it is", async () => {
    mockedLogin.mockRejectedValue({ response: { data: {} } });
    render(<LoginPage />);
    fillAndSubmit();
    await screen.findByTestId("login-error");
    expect(mockedLogin).toHaveBeenLastCalledWith({ username: "nobody", password: "wrong-password", remember: false });

    fireEvent.click(screen.getByRole("checkbox", { name: "auth.remember_me(30)" }));
    fireEvent.click(screen.getByRole("button", { name: "auth.login" }));
    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(2));
    expect(mockedLogin).toHaveBeenLastCalledWith({ username: "nobody", password: "wrong-password", remember: true });
  });
});

describe("忘记密码", () => {
  function openHelp() {
    fireEvent.change(screen.getByLabelText(/auth\.username/), { target: { value: "yama" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.forgot_password" }));
  }

  it("opens a small form carrying the typed username, and confirms neutrally", async () => {
    mockedHelp.mockResolvedValue({ data: { detail: "请求已受理" } });
    render(<LoginPage />);
    openHelp();
    const form = screen.getByTestId("password-help-form");
    expect(within(form).getByLabelText(/auth\.username/)).toHaveValue("yama");
    fireEvent.click(within(form).getByRole("button", { name: "auth.forgot_submit" }));

    expect(await screen.findByRole("status")).toHaveTextContent("auth.forgot_sent");
    expect(mockedHelp).toHaveBeenCalledWith("yama");
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it("shows the same confirmation whatever the 200 body says", async () => {
    // The page must not branch on the body: if the server ever leaked a
    // difference there, the form would still not repeat it.
    const seen: string[] = [];
    for (const body of [{ detail: "请求已受理" }, { detail: "账号不存在" }, {}]) {
      mockedHelp.mockResolvedValueOnce({ data: body });
      const view = render(<LoginPage />);
      openHelp();
      fireEvent.click(screen.getByRole("button", { name: "auth.forgot_submit" }));
      seen.push((await screen.findByTestId("password-help-sent")).textContent ?? "");
      view.unmount();
    }
    expect(new Set(seen).size).toBe(1);
  });

  it("says 'too frequent' on a 429 and stays on the form", async () => {
    mockedHelp.mockRejectedValue({ response: { status: 429 } });
    render(<LoginPage />);
    openHelp();
    fireEvent.click(screen.getByRole("button", { name: "auth.forgot_submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("auth.rate_limited");
    expect(screen.getByTestId("password-help-form")).toBeInTheDocument();
  });

  it("goes back to the sign-in form", () => {
    render(<LoginPage />);
    openHelp();
    fireEvent.click(screen.getByRole("button", { name: "auth.back_to_login" }));
    expect(screen.getByRole("button", { name: "auth.login" })).toBeInTheDocument();
  });
});

// jsdom's `window.location` is non-configurable, so the redirect itself is not
// observable here (E2E asserts /dashboard). What the page assigns is
// `defaultViewRoute()`, and that is what is pinned.
describe("defaultViewRoute", () => {
  it("keeps /dashboard when the server has nothing and nothing is stored locally", async () => {
    expect(await defaultViewRoute()).toBe("/dashboard");
  });

  it("follows the server's value", async () => {
    mockedPrefs.mockResolvedValue({ data: { default_view: "operator" } });
    expect(await defaultViewRoute()).toBe("/judgment/queue");
    mockedPrefs.mockResolvedValue({ data: { default_view: "admin" } });
    expect(await defaultViewRoute()).toBe("/dashboard");
  });

  it("migrates a value left in this browser, once", async () => {
    localStorage.setItem("soulledger_default_view", "operator");
    expect(await defaultViewRoute()).toBe("/judgment/queue");
    expect(mockedSavePrefs).toHaveBeenCalledWith({ default_view: "operator" });
    expect(localStorage.getItem("soulledger_default_view")).toBeNull();
  });

  it("ignores an unknown local value", async () => {
    localStorage.setItem("soulledger_default_view", "judge");
    expect(await defaultViewRoute()).toBe("/dashboard");
    expect(mockedSavePrefs).not.toHaveBeenCalled();
  });

  it("still lets the operator in when the server cannot be asked", async () => {
    mockedPrefs.mockRejectedValue(new Error("offline"));
    expect(await defaultViewRoute()).toBe("/dashboard");
    localStorage.setItem("soulledger_default_view", "operator");
    expect(await defaultViewRoute()).toBe("/judgment/queue");
  });
});
