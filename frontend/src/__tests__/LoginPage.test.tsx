/**
 * app/(auth)/login/page.tsx after A9 (Design 2026-10-03). The E2E spec owns the
 * happy path and the empty-submit refusal; this covers the page's own logic:
 * the three failure states (credentials with tries left, locked with a time,
 * network with a retry) and loading, show / hide password, the statute's three
 * length tiers, the four civilizations, the civilization rows, 保持登录,
 * 忘记密码, and login honouring the server's default view.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LoginPage from "@/app/(auth)/login/page";
import { authApi } from "@soulledger/core/api";
import { LOGIN_STATUTES, type LoginStatute } from "@/src/lib/loginStatutes";
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
    formatDate: (d: Date) => `T${d.getTime()}`,
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

/** The server's limiter, read from where it is defined — the page's sentences must say these numbers. */
const VIEWS = readFileSync(path.join(__dirname, "../../../backend/apps/authentication/views.py"), "utf8");
const MAX_ATTEMPTS = Number(/^LOGIN_MAX_ATTEMPTS = (\d+)$/m.exec(VIEWS)?.[1]);
const WINDOW_MINUTES = Number(/^LOGIN_WINDOW_SECONDS = (\d+)$/m.exec(VIEWS)?.[1]) / 60;

const account = () => screen.getByLabelText(/auth\.account/) as HTMLInputElement;
const password = () => screen.getByLabelText(/auth\.password/) as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: /auth\.(login|submitting)/ });

function fillAndSubmit() {
  fireEvent.change(account(), { target: { value: "nobody" } });
  fireEvent.change(password(), { target: { value: "wrong-password" } });
  fireEvent.click(submitButton());
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockedCivs.mockResolvedValue({ data: CIV_ROWS });
  mockedPrefs.mockResolvedValue({ data: { default_view: null } });
  mockedSavePrefs.mockImplementation(async (body: object) => ({ data: body }));
});

describe("LoginPage · failure states (A9 §二「状态」)", () => {
  it("credentials: one line in danger, tries left in muted, password cleared, account kept, fields not red", async () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(WINDOW_MINUTES).toBeGreaterThan(0);
    mockedLogin.mockRejectedValue({
      response: { status: 401, data: { detail: "No active account found with the given credentials", remaining_attempts: 3 } },
    });
    render(<LoginPage />);
    fillAndSubmit();

    const alert = await screen.findByTestId("login-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveAttribute("data-kind", "credentials");
    const [title, body] = Array.from(alert.querySelectorAll("p"));
    expect(title).toHaveTextContent("! auth.error_credentials");
    expect(title.className).toContain("--color-danger");
    // The minutes come from the server's window, not a number the page made up.
    expect(body).toHaveTextContent(`auth.error_attempts_body(3,${WINDOW_MINUTES})`);
    expect(body.className).not.toContain("--color-danger");
    expect(password().value).toBe("");
    expect(account().value).toBe("nobody");
    expect(account()).not.toHaveAttribute("aria-invalid");
    expect(password()).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(document.activeElement).toBe(password()));
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("credentials without a count: the one line, no tries sentence", async () => {
    mockedLogin.mockRejectedValue({ response: { status: 401, data: { detail: "x" } } });
    render(<LoginPage />);
    fillAndSubmit();
    const alert = await screen.findByTestId("login-error");
    expect(alert.querySelectorAll("p")).toHaveLength(1);
    expect(alert).not.toHaveTextContent("auth.error_attempts_body");
  });

  it("locked: warning border, ◐ title in ink, the time it opens, password and button disabled", async () => {
    const now = 1_700_000_000_000;
    const spy = jest.spyOn(Date, "now").mockReturnValue(now);
    mockedLogin.mockRejectedValue({ response: { status: 429, data: { error: "x", code: "login_locked", retry_after: 601 } } });
    render(<LoginPage />);
    fillAndSubmit();

    const alert = await screen.findByTestId("login-error");
    expect(alert).toHaveAttribute("data-kind", "locked");
    expect(alert.className).toContain("--color-warning");
    const [title, body] = Array.from(alert.querySelectorAll("p"));
    expect(title).toHaveTextContent("◐ auth.error_locked_title");
    expect(title.className).not.toContain("--color-danger");
    expect(body).toHaveTextContent(`auth.error_locked_body(${MAX_ATTEMPTS},T${now + 601_000})`);
    expect(password()).toBeDisabled();
    expect(submitButton()).toBeDisabled();
    spy.mockRestore();
  });

  it("network: 连不上服务器 with a retry that sends what was typed again", async () => {
    mockedLogin.mockRejectedValueOnce(new Error("Network Error"));
    mockedLogin.mockRejectedValueOnce({ response: { status: 401, data: {} } });
    render(<LoginPage />);
    fillAndSubmit();

    const alert = await screen.findByTestId("login-error");
    expect(alert).toHaveAttribute("data-kind", "network");
    expect(alert).toHaveTextContent("! auth.error_network");
    expect(alert).toHaveTextContent("auth.error_network_body");
    // What was typed is kept.
    expect(password().value).toBe("wrong-password");
    fireEvent.click(within(alert).getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(2));
    expect(mockedLogin).toHaveBeenLastCalledWith({ username: "nobody", password: "wrong-password", remember: false });
  });

  it("a 5xx is the network state too, not 「账号或密码不对」", async () => {
    mockedLogin.mockRejectedValue({ response: { status: 502, data: {} } });
    render(<LoginPage />);
    fillAndSubmit();
    expect(await screen.findByTestId("login-error")).toHaveAttribute("data-kind", "network");
  });

  it("loading: the button says 登录中 and the fields are disabled", async () => {
    let reject: (_e: unknown) => void = () => {};
    mockedLogin.mockReturnValue(new Promise((_r, j) => (reject = j)));
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() => expect(submitButton()).toHaveTextContent("auth.submitting"));
    expect(submitButton()).toBeDisabled();
    expect(account()).toBeDisabled();
    expect(password()).toBeDisabled();
    await act(async () => reject({ response: { status: 401, data: {} } }));
  });
});

describe("LoginPage · layout and content", () => {
  it("toggles the password between hidden and shown", () => {
    render(<LoginPage />);
    const toggle = screen.getByRole("button", { name: "soul_app.common.show" });

    expect(password().type).toBe("password");
    fireEvent.click(toggle);
    expect(password().type).toBe("text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent("soul_app.common.hide");
  });

  it("the only <h1> is 登录; the dark band is gone; the brand row carries the mark, hidden from readers", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(mockedCivs).toHaveBeenCalled());
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("auth.login");
    expect(screen.queryByTestId("plaque")).toBeNull();
    expect(screen.queryByTestId("seal")).toBeNull();
    for (const brand of screen.getAllByTestId("login-brand")) {
      expect(brand).toHaveTextContent("灵魂簿");
      expect(brand.querySelector("svg[data-brand-mark]")).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getAllByTestId("login-brand").map((b) => b.querySelector("svg")?.getAttribute("width"))).toEqual(["32", "24"]);
  });

  it("quotes one statute from the fixed corpus list", () => {
    render(<LoginPage />);
    const quote = screen.getByTestId("login-statute").textContent;
    expect(LOGIN_STATUTES.map((s) => s.text)).toContain(quote);
  });

  it("cites it in the canonical 〔文献 · 条号〕 bracket, not 〔条号 · code〕", () => {
    render(<LoginPage />);
    const quote = screen.getByTestId("login-statute").textContent;
    const statute = LOGIN_STATUTES.find((s) => s.text === quote)!;
    const cite = screen.getByTestId("login-statute-cite").textContent ?? "";
    expect(cite).toMatch(/^〔.+ · .+〕$/);
    expect(cite.startsWith("〔") && cite.includes(statute.corpus)).toBe(true);
    expect(cite).not.toContain(statute.code);
  });

  describe("statute length tiers: ≤ 60 · 61–160 · > 160 characters", () => {
    const list = LOGIN_STATUTES as LoginStatute[];
    const extra = (n: number): LoginStatute => ({ ...list[0], code: `T-${n}`, text: "興".repeat(n) });
    let random: jest.SpyInstance;
    beforeEach(() => {
      random = jest.spyOn(Math, "random").mockReturnValue(0.9999);
    });
    afterEach(() => {
      random.mockRestore();
      list.pop();
    });
    const section = () => screen.getByTestId("login-statute").closest("section") as HTMLElement;

    it.each([
      [60, "short"],
      [61, "medium"],
      [160, "medium"],
      [161, "long"],
    ])("%i characters is %s", async (n, tier) => {
      list.push(extra(n));
      render(<LoginPage />);
      await waitFor(() => expect(screen.getByTestId("login-statute").textContent).toHaveLength(n));
      expect(section()).toHaveAttribute("data-statute-tier", tier);
    });

    it("long: folded with a fade and 展开全文 (with its length); expanding shows this one in full", async () => {
      list.push(extra(200));
      render(<LoginPage />);
      await waitFor(() => expect(section()).toHaveAttribute("data-statute-tier", "long"));
      expect(screen.getByTestId("login-statute-fade")).toBeInTheDocument();
      expect(screen.getByText("auth.statute_chars(200)")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /auth\.statute_expand/ }));
      expect(screen.queryByTestId("login-statute-fade")).toBeNull();
      expect(screen.queryByRole("button", { name: /auth\.statute_expand/ })).toBeNull();
      expect(screen.getByTestId("login-statute").className).not.toContain("line-clamp-4");
    });

    it("short and medium are not folded on wide screens: no fade, no wide-screen expand", async () => {
      list.push(extra(100));
      render(<LoginPage />);
      await waitFor(() => expect(section()).toHaveAttribute("data-statute-tier", "medium"));
      expect(screen.queryByTestId("login-statute-fade")).toBeNull();
      // jsdom has no layout, so the 393 four-line clamp never measures as overflowing.
      expect(screen.queryByRole("button", { name: /auth\.statute_expand/ })).toBeNull();
    });
  });

  it("four civilizations: glyph in ink plus name, and the numbering — no civilization colour", () => {
    render(<LoginPage />);
    const civs = screen.getByTestId("login-civs");
    const cells = Array.from(civs.children);
    expect(cells.map((c) => c.textContent)).toEqual([
      "■ organization.civilizations.CHINESE救濟門 · 十七",
      "● organization.civilizations.EUROPEANIX · XXVI",
      "▲ organization.civilizations.EGYPTIAN§ 27 / 42",
      "◆ organization.civilizations.GREEK523a",
    ]);
    expect(civs.innerHTML).not.toMatch(/--color-(main|civ)/);
  });

  it("the bottom row links the welcome page", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "auth.welcome_link" })).toHaveAttribute("href", "/welcome");
  });

  it("does not offer a civilization choice — the login request carries no tenant", async () => {
    mockedLogin.mockRejectedValue({ response: { status: 401, data: {} } });
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
    expect(submitButton()).toBeEnabled();
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
    mockedLogin.mockRejectedValue({ response: { status: 401, data: {} } });
    render(<LoginPage />);
    fillAndSubmit();
    await screen.findByTestId("login-error");
    expect(mockedLogin).toHaveBeenLastCalledWith({ username: "nobody", password: "wrong-password", remember: false });

    fireEvent.click(screen.getByRole("checkbox", { name: "auth.remember_me(30)" }));
    // The failed attempt cleared the password; type it again.
    fireEvent.change(password(), { target: { value: "wrong-password" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(2));
    expect(mockedLogin).toHaveBeenLastCalledWith({ username: "nobody", password: "wrong-password", remember: true });
  });
});

describe("忘记密码", () => {
  function openHelp() {
    fireEvent.change(screen.getByLabelText(/auth\.account/), { target: { value: "yama" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.forgot_password" }));
  }

  it("opens a small form carrying the typed username, and confirms neutrally", async () => {
    mockedHelp.mockResolvedValue({ data: { detail: "请求已受理" } });
    render(<LoginPage />);
    openHelp();
    const form = screen.getByTestId("password-help-form");
    expect(within(form).getByLabelText(/auth\.account/)).toHaveValue("yama");
    fireEvent.click(within(form).getByRole("button", { name: "auth.forgot_submit" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("auth.forgot_sent");
    // The one sentence for every username: whether the account exists is not said here either.
    expect(status).toHaveTextContent("auth.forgot_sent_body");
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
