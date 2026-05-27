/**
 * Tests for src/components/rbac/PermissionDenied.tsx
 */
import { render, screen } from "@testing-library/react";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

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
  it("should render the lock emoji", () => {
    render(<PermissionDenied />);
    expect(screen.getByText("🔒")).toBeInTheDocument();
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

  it("should render heading as an h1 element", () => {
    render(<PermissionDenied />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Access Denied");
  });
});
