/**
 * Tests for PageError component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PageError } from "@/src/components/ui/PageError";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "error.title": "Server Error",
        "error.description": "Something went wrong",
        "error.retry": "Retry",
        "error.home": "Return Home",
      };
      return map[key] || key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

describe("PageError", () => {
  it("renders error title and error message", () => {
    const error = new Error("Test error");
    render(<PageError error={error} reset={() => {}} />);
    expect(screen.getByText("Server Error")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("renders retry button", () => {
    const error = new Error("Test error");
    render(<PageError error={error} reset={() => {}} />);
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("calls reset when retry is clicked", () => {
    const reset = jest.fn();
    const error = new Error("Test error");
    render(<PageError error={error} reset={reset} />);
    fireEvent.click(screen.getByText("Retry"));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders error message from error object", () => {
    const error = new Error("Custom error message");
    render(<PageError error={error} reset={() => {}} />);
    expect(screen.getByText("Custom error message")).toBeInTheDocument();
  });
});
