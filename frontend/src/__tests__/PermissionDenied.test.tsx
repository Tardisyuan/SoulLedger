/**
 * Tests for src/components/rbac/PermissionDenied.tsx
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionDenied, MissingPermissionContext } from "@/src/components/rbac/PermissionDenied";
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";

// Mock the I18nContext so t() returns predictable strings
jest.mock("@/src/contexts/I18nContext", () =>
  require("./support/mocks").i18nMock({
    map: {
      "permission.denied_title": "Access Denied",
      "permission.denied_message":
        "You do not have permission to view this page.",
    },
    locale: "en",
    setLocale: jest.fn(),
    hydrated: true,
  }),
);

describe("PermissionDenied", () => {
  it("draws no lock — C15 draws an in-page state, not an emoji", () => {
    render(<PermissionDenied />);
    expect(screen.queryByText("🔒")).toBeNull();
  });

  // review-2026-11-01 Web 2:说缺的是哪个权限,用可读名称;原始权限码不出现在页面上。
  it("names the missing permission by its readable name, never by its code", () => {
    // The file's default mock echoes unknown keys, which is "no name in the bundle" — so this test
    // swaps in one that knows the name (and only then is there a line to draw).
    const real = jest.requireMock("@/src/contexts/I18nContext").useI18n;
    jest.requireMock("@/src/contexts/I18nContext").useI18n = () => ({
      t: (key: string, p?: Record<string, string>) =>
        key === "permission.needs" ? `需要「${p?.names}」` : key === "permission.names.ledger.read" ? "查看功德" : key,
    });
    const { rerender } = render(<PermissionDenied />);
    expect(screen.queryByTestId("permission-denied-needs")).toBeNull();
    rerender(<PermissionDenied permission="ledger.read" />);
    expect(screen.getByTestId("permission-denied-needs")).toHaveTextContent("需要「查看功德」");
    expect(screen.queryByTestId("permission-denied-code")).toBeNull();
    expect(screen.getByTestId("permission-denied").textContent).not.toContain("ledger.read");
    jest.requireMock("@/src/contexts/I18nContext").useI18n = real;
  });

  it("reads the gate from RequirePermission / RequireAdmin, so a bare fallback still says what is missing", () => {
    const real = jest.requireMock("@/src/contexts/I18nContext").useI18n;
    const names: Record<string, string> = {
      "permission.names.judgment.read": "查看审判",
      "permission.needs_admin": "这一页只对管理员开放。",
    };
    jest.requireMock("@/src/contexts/I18nContext").useI18n = () => ({
      t: (key: string, p?: Record<string, string>) =>
        key === "permission.needs" ? `需要「${p?.names}」` : (names[key] ?? key),
    });
    const { rerender } = render(
      <MissingPermissionContext.Provider value={{ permissions: ["judgment.read"] }}>
        <PermissionDenied />
      </MissingPermissionContext.Provider>
    );
    expect(screen.getByTestId("permission-denied-needs")).toHaveTextContent("需要「查看审判」");
    expect(screen.getByTestId("permission-denied").textContent).not.toContain("judgment.read");
    // 语言包里没有名称的码:不写这一行,也不把码露出来。
    rerender(
      <MissingPermissionContext.Provider value={{ permissions: ["brand_new.read"] }}>
        <PermissionDenied />
      </MissingPermissionContext.Provider>
    );
    expect(screen.queryByTestId("permission-denied-needs")).toBeNull();
    expect(screen.getByTestId("permission-denied").textContent).not.toContain("brand_new");
    rerender(
      <MissingPermissionContext.Provider value={{ admin: true }}>
        <PermissionDenied />
      </MissingPermissionContext.Provider>
    );
    expect(screen.getByTestId("permission-denied-needs")).toHaveTextContent("这一页只对管理员开放。");
    jest.requireMock("@/src/contexts/I18nContext").useI18n = real;
  });

  it("has a readable name in zh-Hans and en for every code a page gates on", () => {
    const codes = ["actors.read", "capture.read", "city_god.read", "dispatch.manage", "dispatch.read", "disposition.read",
      "judgment.read", "ledger.read", "menu.read", "org.read", "realms.read", "reincarnation.read", "scheduler.read",
      "session.manage", "social.moderate", "soul.read", "soul_account.read", "soul_inbox.read", "system.settings",
      "tudi.read", "workflow.read"];
    const get = (b: unknown, code: string) => code.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], (b as { permission: { names: unknown } }).permission.names);
    for (const code of codes) {
      expect(typeof get(zh, code)).toBe("string");
      expect(typeof get(en, code)).toBe("string");
    }
  });

  it("should render the denied title via i18n", () => {
    render(<PermissionDenied />);
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("should render the denied message via i18n", () => {
    render(<PermissionDenied />);
    expect(
      screen.getByText("You do not have permission to view this page.")
    ).toBeInTheDocument();
  });

  it("should use the correct i18n key for the title", () => {
    // With our mock, unknown keys are returned as-is.
    // Replace the mock temporarily to verify key usage.
    const original = jest.requireMock("@/src/contexts/I18nContext").useI18n;
    jest.requireMock("@/src/contexts/I18nContext").useI18n = () => ({
      locale: "en",
      setLocale: jest.fn(),
      t: (key: string) => key, // return raw key
      hydrated: true,
    });

    render(<PermissionDenied />);
    expect(screen.getByText("permission.denied_title")).toBeInTheDocument();
    expect(screen.getByText("permission.denied_message")).toBeInTheDocument();

    // Restore
    jest.requireMock("@/src/contexts/I18nContext").useI18n = original;
  });

  it("asks the reader to find the hall's administrator (Design E 组), in all three bundles", () => {
    render(<PermissionDenied />);
    // The mock returns unknown keys as-is: the sentence is drawn from its own key.
    expect(screen.getByTestId("permission-denied-ask")).toHaveTextContent("permission.ask_admin");
    expect(zh.permission.ask_admin).toBe("请找本殿管理员。");
    expect(en.permission.ask_admin).toBe("Ask your hall's administrator.");
    // Administrators hang off the tenant (User.tenant; the password-help task notifies the
    // tenant's own ADMINs), so Design's `Per Pen` variant — not the court's `Wesekhet Pen`.
    expect(egy.permission.ask_admin).toBe("Dbh Er Sab Hery En Per Pen");
    expect(egy.permission.ask_admin).not.toContain("Wesekhet");
  });

  // 规范 v3(2026-10-01):403 与 404 / 500 是同一块卡;代码 403 是 ink,冷玫红只给 500。
  it("is the v3 status card: code 403 in ink, and nothing in the card is cold rose", () => {
    const { container } = render(<PermissionDenied />);
    const card = screen.getByTestId("permission-denied");
    expect(card).toHaveAttribute("data-page-error");
    expect(card.className).toContain("bg-[oklch(var(--color-surface-1))]");
    const code = card.querySelector<HTMLElement>("[data-page-error-code]")!;
    expect(code.textContent).toBe("403");
    expect(code.className).toContain("text-[oklch(var(--color-ink))]");
    expect(container.querySelectorAll('[class*="--color-danger"]')).toHaveLength(0);
  });

  it("has one secondary button, 返回上一页, that goes back in history", () => {
    const back = jest.spyOn(window.history, "back").mockImplementation(() => {});
    render(<PermissionDenied />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("permission.go_back");
    fireEvent.click(buttons[0]);
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
    expect(zh.permission.go_back).toBe("返回上一页");
    expect(en.permission.go_back).toBe("Go back");
    // egy:第三节审定(R1)定稿 —— 返回 = Wehem Er …,上一页 = Medjat Pehwy。
    // Khet 已定为「内容 / 之后」,单用表达不了「返回」(docs/design-handoff/v3-prompts/egy-277-第三节-审定结果.md)。
    expect(egy.permission.go_back).toBe("Wehem Er Medjat Pehwy");
  });

  it("should render heading as an h1 element", () => {
    render(<PermissionDenied />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Access Denied");
  });
});
