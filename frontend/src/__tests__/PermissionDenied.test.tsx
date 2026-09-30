/**
 * Tests for src/components/rbac/PermissionDenied.tsx
 */
import { render, screen } from "@testing-library/react";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";

// Mock the I18nContext so t() returns predictable strings
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: jest.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        "permission.denied_title": "Access Denied",
        "permission.denied_message":
          "You do not have permission to view this page.",
      };
      return map[key] ?? key;
    },
    hydrated: true,
  }),
}));

describe("PermissionDenied", () => {
  it("draws no lock — C15 draws an in-page state, not an emoji", () => {
    render(<PermissionDenied />);
    expect(screen.queryByText("🔒")).toBeNull();
  });

  it("names the missing permission code when given one, and only then", () => {
    const { rerender } = render(<PermissionDenied />);
    expect(screen.queryByTestId("permission-denied-code")).toBeNull();
    rerender(<PermissionDenied permission="ledger.read" />);
    expect(screen.getByTestId("permission-denied-code")).toHaveTextContent("ledger.read");
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

  it("should render heading as an h1 element", () => {
    render(<PermissionDenied />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Access Denied");
  });
});
