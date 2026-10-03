/**
 * Tests for PageError component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PageError, StatusCard } from "@/src/components/ui/PageError";
import NotFound from "@/app/not-found";
import WelcomeError from "@/app/welcome/error";
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";

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

/**
 * 403 / 404 / 500 是同一块 v3 卡(用户 2026-10-01 拍板)。冷玫红只给 500 的代码;
 * 403 / 404 的代码是 ink —— 断言缺席:它们的树里一处 `--color-danger` 都没有。
 */
jest.mock("next/navigation", () => ({ usePathname: () => "/no-such-page" }));

describe("StatusCard · 403 / 404 与 500 同一块卡", () => {
  const danger = (root: HTMLElement) => root.querySelectorAll('[class*="--color-danger"]').length;

  it.each(["403", "404"] as const)("%s 的代码是 ink,整块卡里没有冷玫红", (code) => {
    const { container } = render(
      <StatusCard code={code} title="T" message="M" action={<button type="button">B</button>} />
    );
    const el = container.querySelector<HTMLElement>("[data-page-error-code]")!;
    expect(el.textContent).toBe(code);
    expect(el.className).toContain("text-[oklch(var(--color-ink))]");
    expect(danger(container)).toBe(0);
    expect(screen.getByRole("status")).toBe(container.firstChild);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("500 的卡是 alert,代码是唯一一处冷玫红", () => {
    const { container } = render(<PageError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("alert")).toBe(container.firstChild);
    expect(danger(container)).toBe(1);
  });

  it("not-found:同一块卡,代码 404 是 ink,标题是唯一的 <h1>,一颗「回到首页」链接,路径在细节行", () => {
    const { container } = render(<NotFound />);
    expect(container.querySelector("[data-page-error]")).not.toBeNull();
    expect(container.querySelector("[data-page-error-code]")!.textContent).toBe("404");
    expect(danger(container)).toBe(0);
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("not_found.title");
    expect(screen.getByRole("link", { name: "not_found.home" })).toHaveAttribute("href", "/");
    // v2 的「返回」按钮与匾都没了:卡里只有一个动作。
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("/no-such-page").className).toMatch(/\bfont-mono\b/);
  });

  it("welcome/error 走 PageError:同一块 500 卡,不再是自画的 status-error 与主按钮", () => {
    const reset = jest.fn();
    const { container } = render(<WelcomeError error={new Error("boom")} reset={reset} />);
    expect(container.querySelector("[data-page-error]")).not.toBeNull();
    expect(container.querySelector("[data-page-error-code]")!.className).toContain("--color-danger");
    expect(container.innerHTML).not.toContain("--color-status-error");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("500 的文案是规范 v3 的(2026-10-01)", () => {
  // egy:标题沿用已审的 Sethet(只表技术错误,中文仍含「错误」);按钮从 Wehem Iri(再做)
  // 换成包里已有的「重新加载」= Wehem Ini(permissions.matrix.conflict_reload_button 等)——
  // egyLexiconRules「加载一律 Ini」要求中文含「载入」的键必含 Ini。
  it("系统发生错误 / 重新载入;egy Sethet / Wehem Ini", () => {
    expect(zh.error.title).toBe("系统发生错误");
    expect(zh.error.retry).toBe("重新载入");
    expect(en.error.title).toBe("A system error occurred");
    expect(en.error.retry).toBe("Reload");
    expect(egy.error.title).toBe("Sethet");
    expect(egy.error.retry).toBe("Wehem Ini");
  });
});
