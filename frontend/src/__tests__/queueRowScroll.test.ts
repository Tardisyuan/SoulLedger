/**
 * 审判队列选中行滚进视野(v3 第 7 轮 App.tsx「滚动进视野」):只沿纵轴,160ms、进场曲线;减少动态效果下瞬时。
 */
const animate = jest.fn((_from: number, _to: number, _opts: Record<string, unknown>) => ({ stop: jest.fn() }));
jest.mock("motion/react", () => ({ ...jest.requireActual("motion/react"), animate: (...a: [number, number, Record<string, unknown>]) => animate(...a) }));

import { scrollRowIntoView } from "@/src/components/judgment/JudgmentClaimQueue";

let reduced = false;
const scrollTo = jest.fn();

function rowAt(top: number, headBottom = 100): HTMLElement {
  document.body.innerHTML = `<table><thead><tr><th></th></tr></thead><tbody><tr id="r"><td></td></tr></tbody></table>`;
  const row = document.getElementById("r")!;
  const rect = (t: number, h: number) => ({ top: t, bottom: t + h, left: 0, right: 0, width: 0, height: h, x: 0, y: t, toJSON: () => ({}) }) as DOMRect;
  row.getBoundingClientRect = () => rect(top, 64);
  document.querySelector("thead")!.getBoundingClientRect = () => rect(headBottom - 44, 44);
  return row;
}

beforeEach(() => {
  animate.mockClear();
  scrollTo.mockClear();
  reduced = false;
  Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.includes("reduce"), media: q }),
  });
});

it("below the fold: scrolls down just enough, over 160ms on the enter curve, vertical only", () => {
  scrollRowIntoView(rowAt(780));
  expect(animate).toHaveBeenCalledTimes(1);
  const [from, to, opts] = animate.mock.calls[0];
  expect([from, to]).toEqual([500, 500 + (780 + 64 - 800)]);
  expect(opts).toMatchObject({ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] });
  (opts.onUpdate as (_y: number) => void)(520);
  expect(scrollTo).toHaveBeenCalledWith(window.scrollX, 520);
});

it("under the sticky header: scrolls up until the row clears it", () => {
  scrollRowIntoView(rowAt(60, 100));
  expect(animate.mock.calls[0].slice(0, 2)).toEqual([500, 460]);
});

it("already in view: does not scroll", () => {
  scrollRowIntoView(rowAt(300));
  expect(animate).not.toHaveBeenCalled();
  expect(scrollTo).not.toHaveBeenCalled();
});

it("reduced motion: instant", () => {
  reduced = true;
  scrollRowIntoView(rowAt(780));
  expect(animate).not.toHaveBeenCalled();
  expect(scrollTo).toHaveBeenCalledWith(window.scrollX, 544);
});
