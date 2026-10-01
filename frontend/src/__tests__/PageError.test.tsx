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

/**
 * 规范 v3 错误页(2026-10-01):s1 底、至少 200px、居中;等宽 28px 的「500」是冷玫红,
 * 而且**只有它是** —— 标题是 ink 的 `<h1>`,text-lg(DESIGN.md「Headings」页面标题)。
 */
describe("PageError · 规范 v3", () => {
  const render500 = () => render(<PageError error={new Error("boom")} reset={() => {}} />);

  it("一块 s1 底、至少 200px 高、居中的卡片", () => {
    const { container } = render500();
    const root = container.querySelector<HTMLElement>("[data-page-error]")!;
    expect(root.className).toContain("bg-[oklch(var(--color-surface-1))]");
    expect(root.className).toMatch(/\bmin-h-\[200px\]/);
    expect(root.className).toMatch(/\bitems-center\b/);
    expect(root.className).toMatch(/\bjustify-center\b/);
  });

  it("代码 500:等宽、28px(text-xl)、冷玫红", () => {
    const { container } = render500();
    const code = container.querySelector<HTMLElement>("[data-page-error-code]")!;
    expect(code.textContent).toBe("500");
    expect(code.className).toMatch(/\bfont-mono\b/);
    expect(code.className).toMatch(/\btext-xl\b/);
    expect(code.className).toContain("text-[oklch(var(--color-danger))]");
  });

  it("标题是一个 text-lg 的 <h1>,ink 色 —— 冷玫红只给代码", () => {
    const { container } = render500();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Server Error");
    expect(h1.className).toMatch(/\btext-lg\b/);
    expect(h1.className).toContain("text-[oklch(var(--color-ink))]");
    // 缺席:除了代码,树里没有第二处冷玫红(v2 的标题与 ✕ 都是冷玫红)。
    const danger = Array.from(container.querySelectorAll('[class*="--color-danger"]'));
    expect(danger.map((el) => el.hasAttribute("data-page-error-code"))).toEqual([true]);
    expect(container.textContent).not.toContain("✕");
  });
});
