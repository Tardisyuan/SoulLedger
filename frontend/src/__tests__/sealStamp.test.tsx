/**
 * 印落下(v3 第 7 轮 App.tsx 动效表):scale 1.7 → .96 → 1、opacity 0 → 1,320ms,强调曲线
 * cubic-bezier(.2,.8,.3,1)。减少动态效果:不播,印直接在最终位置。jsdom 没有 WAAPI,这里换上一个记录器。
 */
import { render } from "@testing-library/react";

import { Seal } from "@/src/components/plaque/Seal";

const animate = jest.fn(() => ({ cancel: jest.fn() }));
let reduced = false;

beforeEach(() => {
  animate.mockClear();
  reduced = false;
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.includes("reduce"), media: q }),
  });
});

afterAll(() => {
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

it("stamps by scale 1.7 → .96 → 1 with opacity 0 → 1, 320ms on the emphasis curve", () => {
  render(<Seal size={72} civ="cn" stampKey={1} />);
  expect(animate).toHaveBeenCalledTimes(1);
  const [frames, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
  expect(frames).toEqual([
    { offset: 0, opacity: 0, transform: "scale(1.7)" },
    { offset: 0.75, opacity: 1, transform: "scale(0.96)" },
    { offset: 1, opacity: 1, transform: "scale(1)" },
  ]);
  // No v2 drop left behind.
  expect(JSON.stringify(frames)).not.toMatch(/translate/);
  expect(options).toEqual({ duration: 320, easing: "cubic-bezier(0.2,0.8,0.3,1)" });
});

it("does not stamp without a stampKey", () => {
  render(<Seal size={72} civ="cn" />);
  expect(animate).not.toHaveBeenCalled();
});

it("reduced motion: no animation, the seal is simply there", () => {
  reduced = true;
  render(<Seal size={72} civ="cn" stampKey={1} />);
  expect(animate).not.toHaveBeenCalled();
});
