/**
 * 落印(Design 第五十三批 G1):审判页的印与案卷台、官员 App 是同一下 —— globals.css 的 `.stamp-in`
 * (200ms、1.18 → 1、透明度 0 → 1,参数由 sealMotionTokens.test.ts 守着)。此前这里是 WAAPI 的 1.7 → .96 → 1
 * 加一圈文明光,Design 定为去掉。jsdom 不跑 CSS 动画,所以这里看的是:印挂没挂那个类、每次落印是不是重挂、
 * 而且不再调 `element.animate`(没有自己那一份,也没有光晕)。
 */
import { render, screen } from "@testing-library/react";

import { Seal } from "@/src/components/plaque/Seal";

const animate = jest.fn(() => ({ cancel: jest.fn() }));

beforeEach(() => {
  animate.mockClear();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});

afterAll(() => {
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

it("stamps with the shared class, and draws no WAAPI drop or glow ring of its own", () => {
  render(<Seal size={72} civ="cn" stampKey={1} />);
  expect(screen.getByTestId("seal")).toHaveClass("seal", "stamp-in");
  expect(animate).not.toHaveBeenCalled();
});

it("each new stampKey remounts the seal, so the one CSS drop plays again", () => {
  const { rerender } = render(<Seal size={72} civ="cn" stampKey={1} />);
  const first = screen.getByTestId("seal");
  rerender(<Seal size={72} civ="cn" stampKey={1} />);
  expect(screen.getByTestId("seal")).toBe(first);
  rerender(<Seal size={72} civ="cn" stampKey={2} />);
  expect(screen.getByTestId("seal")).not.toBe(first);
  expect(screen.getByTestId("seal")).toHaveClass("stamp-in");
});

it("does not stamp without a stampKey", () => {
  render(<Seal size={72} civ="cn" />);
  expect(screen.getByTestId("seal")).not.toHaveClass("stamp-in");
});
