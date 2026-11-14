/**
 * 页头记号的避让(Design 第四十六批第三节,`useHeadMarkAvoidance`,src/components/brand/HeadMark.tsx):
 *   - 没有右侧按钮:CSS 的 right 20;
 *   - 有按钮:记号右缘退到按钮组左边 16px(right = 页头右缘 − 按钮组左缘 + 16);
 *   - 标题右缘离记号左缘不足 24px:记号不画(`hidden`)。
 * jsdom 不排版,几何由这里给:页头 0–1000,按钮组从 760 起,记号 26 宽,标题的字右缘按用例给(Range 的盒)。
 */
import { render, screen } from "@testing-library/react";

const mockTenant = { code: "CN_DIYU", display_name: "第五殿" };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: mockTenant } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans" }),
}));

import { PageHead } from "@/src/components/ui/PageShell";

const box = (left: number, right: number) =>
  ({ left, right, width: right - left, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

let headWidth = 1000;
let titleRight = 0;

function rectOf(el: HTMLElement): DOMRect {
  if (el.matches('[data-testid="page-head"]')) return box(0, headWidth);
  if (el.matches("[data-page-shell-actions]")) return box(760, 980);
  if (el.classList.contains("page-head-mark")) return el.hidden ? box(0, 0) : box(0, 26);
  return box(0, 0);
}

const ELEMENT_RECT = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");

beforeEach(() => {
  headWidth = 1000;
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return rectOf(this as HTMLElement);
    },
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => box(32, titleRight) });
});

afterEach(() => {
  // HTMLElement 上本来没有自己的这一项(继承自 Element);删掉就回到 jsdom 的。
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  expect(Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")).toEqual(ELEMENT_RECT);
});

const mark = () => screen.getByTestId("page-head").querySelector<HTMLElement>(".page-head-mark")!;
const actions = <button type="button">登记一个灵魂</button>;

describe("页头记号的避让", () => {
  it("没有右侧按钮:right 20,画", () => {
    titleRight = 200;
    render(<PageHead title="名册" />);
    expect(mark().style.right).toBe("20px");
    expect(mark()).not.toHaveAttribute("hidden");
  });

  it("有按钮:右缘退到按钮组左边 16px(1000 − 760 + 16 = 256),不再是 20", () => {
    titleRight = 200;
    render(<PageHead title="名册" actions={actions} />);
    expect(mark().style.right).toBe("256px");
    expect(mark().style.right).not.toBe("20px");
    expect(mark()).not.toHaveAttribute("hidden");
  });

  // 记号左缘 = 1000 − 256 − 26 = 718;标题右缘 + 24 超过它就不画。
  it.each([
    [694, false],
    [695, true],
    [900, true],
  ])("有按钮、标题的字右缘到 %i:不画 = %s", (right, hidden) => {
    titleRight = right;
    render(<PageHead title="一个很长很长的标题" actions={actions} />);
    if (hidden) expect(mark()).toHaveAttribute("hidden");
    else expect(mark()).not.toHaveAttribute("hidden");
  });

  it("没有按钮时同一条:记号左缘 1000 − 20 − 26 = 954,标题到 931 就不画", () => {
    titleRight = 931;
    render(<PageHead title="一个很长很长的标题" />);
    expect(mark()).toHaveAttribute("hidden");
  });

  it("页头没排版(宽 0:隐藏的页)时不动,留给 CSS", () => {
    headWidth = 0;
    titleRight = 900;
    render(<PageHead title="名册" actions={actions} />);
    expect(mark().style.right).toBe("");
    expect(mark()).not.toHaveAttribute("hidden");
  });
});
