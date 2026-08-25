/**
 * EmptyState —— Stage 11 B slots。
 *
 * 迁移前是 23 处手搓、15 种写法。这个文件盯三条规格，两条写成「断言缺席」：
 *   1. **居左**。失败模式是有人为了「好看」加回 `text-center` —— 而
 *      「标题渲染出来了」在居中的时候照样是绿的，所以必须直接断言那几个类名
 *      不在树里。
 *   2. 标题上方一条 **24px × 2px** 的短线，颜色取 `--civ-mark`。失败模式是
 *      有人给它兜一个彩色 fallback：`--civ-mark` 在未映射租户下是灰色
 *      （`app/globals.css:57`），那是刻意的，灰色说的是「没有文明」。
 *   3. `text-01` 标题 + `text-04` 原因。
 */
import { render } from "@testing-library/react";
import { EmptyState } from "@/src/components/ui/EmptyState";

/** 整棵树上所有元素的 class 字符串。 */
function allClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("*")).map(
    (el) => el.getAttribute("class") ?? ""
  );
}

describe("EmptyState · 内容", () => {
  it("渲染标题、原因、动作", () => {
    const { getByText } = render(
      <EmptyState
        title="尚无判决"
        reason="这一卷还没有任何灵魂被登记。"
        action={<button>登记第一条</button>}
      />
    );
    expect(getByText("尚无判决")).toBeInTheDocument();
    expect(getByText("这一卷还没有任何灵魂被登记。")).toBeInTheDocument();
    expect(getByText("登记第一条")).toBeInTheDocument();
  });

  it("原因与动作是可选的，不传就整段不渲染", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    expect(container.querySelector("[data-empty-state-title]")).not.toBeNull();
    expect(container.querySelector("[data-empty-state-reason]")).toBeNull();
    expect(container.querySelector("[data-empty-state-action]")).toBeNull();
  });
});

describe("EmptyState · 居左", () => {
  it("整棵树上没有任何居中类名", () => {
    const { container } = render(
      <EmptyState
        title="尚无判决"
        reason="这一卷还没有任何灵魂被登记。"
        action={<button>登记第一条</button>}
      />
    );
    const centring = allClasses(container).filter((c) =>
      /\b(text-center|items-center|justify-center|mx-auto|place-items-center)\b/.test(c)
    );
    expect(centring).toEqual([]);
  });

  it("外层 className 是追加的，不改上面那条居左的约定", () => {
    const { container } = render(
      <EmptyState title="尚无判决" className="border border-hairline" />
    );
    const root = container.querySelector<HTMLElement>("[data-empty-state]")!;
    expect(root.className).toMatch(/\bborder-hairline\b/);
    expect(root.className).toMatch(/\bpy-10\b/);
  });
});

describe("EmptyState · 那条短线", () => {
  it("24px 长、2px 粗，压在标题上方", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    const mark = container.querySelector<HTMLElement>("[data-empty-state-mark]")!;
    expect(mark.className).toMatch(/\bw-6\b/); // 24px
    expect(mark.className).toMatch(/\bborder-t-2\b/); // 2px
    const title = container.querySelector<HTMLElement>("[data-empty-state-title]")!;
    expect(mark.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("颜色直接取 --civ-mark，没有 fallback —— 未映射租户下的灰是刻意的", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    const mark = container.querySelector<HTMLElement>("[data-empty-state-mark]")!;
    expect(mark.className).toContain("border-[hsl(var(--civ-mark))]");
    // `var(--civ-mark, …)` 的第二个参数就是 fallback；出现逗号即违规。
    expect(mark.className).not.toMatch(/var\(--civ-mark\s*,/);
    // 也不许改用别的颜色 token 顶替。
    expect(mark.className).not.toMatch(/--color-civ-mark-/);
    expect(mark.className).not.toMatch(/--color-accent/);
  });

  it("短线是标记不是内容，对读屏隐藏", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    expect(container.querySelector("[data-empty-state-mark]")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });
});

describe("EmptyState · 排版", () => {
  it("标题 text-01，原因 text-04 + text-ink-subtle", () => {
    const { container } = render(
      <EmptyState title="尚无判决" reason="这一卷还没有任何灵魂被登记。" />
    );
    const title = container.querySelector<HTMLElement>("[data-empty-state-title]")!;
    const reason = container.querySelector<HTMLElement>("[data-empty-state-reason]")!;
    expect(title.className).toMatch(/\btext-01\b/);
    expect(reason.className).toMatch(/\btext-04\b/);
    expect(reason.className).toMatch(/\btext-ink-subtle\b/);
  });

  it("空态不产生标题层级 —— 它是卷宗里的一条注记，不是一个区块", () => {
    const { container } = render(<EmptyState title="尚无判决" />);
    expect(container.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
  });
});
