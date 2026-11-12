/**
 * EmptyState —— Stage 11 B slots;第三十批「卷宗」第 1 步第 5 条重画。
 *
 * 迁移前是 23 处手搓、15 种写法。这个文件盯三条规格(Design v4 第三十批回复第一节第 5 条):
 *   1. **G 天体仪记号 96、12% 不透明**,压在说明上方,对读屏隐藏 —— v3 的 28px □ 与 160 线稿背景都不在了。
 *   2. **一句说明**:宋体标题 + 一句 13 的原因。
 *   3. **一个下一步**。
 * 居中(稿子 `.state`);v1 / v2 的「居左」随这一批撤掉 —— 缺席也断言,免得 □ 或居左的写法回来时照样绿。
 */
import { render } from "@testing-library/react";
import { EmptyState } from "@/src/components/ui/EmptyState";

let mockTenantCode: string | null = "CN_DIYU";
jest.mock("@/src/contexts/TenantContext", () => ({
  ...jest.requireActual("@/src/contexts/TenantContext"),
  useTenant: () => ({ user: mockTenantCode ? { tenant: { code: mockTenantCode, display_name: mockTenantCode } } : null }),
}));
afterEach(() => {
  mockTenantCode = "CN_DIYU";
});

describe("EmptyState · 内容", () => {
  it("渲染标题、原因、动作", () => {
    const { getByText } = render(
      <EmptyState
        title="今天没有待认领的案卷"
        reason="新的案子到了会出现在这里。"
        action={<button>看已结案</button>}
      />
    );
    expect(getByText("今天没有待认领的案卷")).toBeInTheDocument();
    expect(getByText("新的案子到了会出现在这里。")).toBeInTheDocument();
    expect(getByText("看已结案")).toBeInTheDocument();
  });

  it("原因与动作是可选的，不传就整段不渲染", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    expect(container.querySelector("[data-empty-state-title]")).not.toBeNull();
    expect(container.querySelector("[data-empty-state-reason]")).toBeNull();
    expect(container.querySelector("[data-empty-state-action]")).toBeNull();
  });

  it("外层 className 是追加的", () => {
    const { container } = render(
      <EmptyState title="尚无判决" className="border border-[oklch(var(--color-line))]" />
    );
    const root = container.querySelector<HTMLElement>("[data-empty-state]")!;
    expect(root.className).toContain("border-[oklch(var(--color-line))]");
    expect(root.className).toMatch(/\bpy-8\b/);
  });
});

describe("EmptyState · 记号", () => {
  it("G 天体仪 96、12%,在标题上方,对读屏隐藏;v3 的 □ 不在了", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    const mark = container.querySelector<HTMLElement>("[data-civ-mark]")!;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveClass("empty-mark");
    expect(mark.style.getPropertyValue("--emblem-size")).toBe("96px");
    const title = container.querySelector<HTMLElement>("[data-empty-state-title]")!;
    expect(mark.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain("□");
    expect(container.querySelector("[data-empty-state-mark], .empty-emblem")).toBeNull();
  });

  it("记号默认画此刻所在的殿的文明;给了 civilization 就画那一个;认不出只画环", () => {
    const mark = (c: HTMLElement) => c.querySelector("[data-civ-mark]")!.getAttribute("data-civ-mark");
    const { container: here, unmount } = render(<EmptyState title="x" />);
    expect(mark(here)).toBe("cn");
    unmount();
    const { container: given, unmount: u2 } = render(<EmptyState title="x" civilization="EGYPTIAN" />);
    expect(mark(given)).toBe("eg");
    u2();
    mockTenantCode = null;
    const { container: neutral } = render(<EmptyState title="x" />);
    expect(mark(neutral)).toBe("neutral");
  });
});

describe("EmptyState · 排版", () => {
  it("居中(稿子 .state);标题宋体 20/28,原因 13 + ink-subtle", () => {
    const { container } = render(<EmptyState title="尚无判决" reason="这一卷还没有任何灵魂被登记。" />);
    const root = container.querySelector<HTMLElement>("[data-empty-state]")!;
    expect(root.className).toMatch(/\bitems-center\b/);
    expect(root.className).toMatch(/\btext-center\b/);
    const title = container.querySelector<HTMLElement>("[data-empty-state-title]")!;
    const reason = container.querySelector<HTMLElement>("[data-empty-state-reason]")!;
    expect(title.className).toMatch(/\bfont-title\b/);
    expect(title.className).toMatch(/\btext-lg\b/);
    expect(reason.className).toMatch(/\btext-sm\b/);
    expect(reason.className).toContain("text-[oklch(var(--color-ink-subtle))]");
  });

  it("空态不产生标题层级 —— 它是这一块的一句话，不是一个区块", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    expect(container.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
  });
});
