/**
 * 审判队列选中行滚进视野(v3 第 7 轮 App.tsx「滚动进视野」):只沿纵轴,160ms、进场曲线;减少动态效果下瞬时。
 * 2026-10-30 起是自己的 requestAnimationFrame 补间(不再静态拉 motion 的 `animate`),这里手动推帧。
 */
import { cubicBezier, scrollRowIntoView } from "@/src/components/judgment/JudgmentClaimQueue";

let reduced = false;
const scrollTo = jest.fn();
let frames: FrameRequestCallback[] = [];

/** Run queued frames at `t` ms until the tween stops asking for more. */
function runFrames(...times: number[]) {
  for (const t of times) {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(t);
  }
}

function rowAt(top: number, headBottom = 100): HTMLElement {
  document.body.innerHTML = `<table><thead><tr><th></th></tr></thead><tbody><tr id="r"><td></td></tr></tbody></table>`;
  const row = document.getElementById("r")!;
  const rect = (t: number, h: number) => ({ top: t, bottom: t + h, left: 0, right: 0, width: 0, height: h, x: 0, y: t, toJSON: () => ({}) }) as DOMRect;
  row.getBoundingClientRect = () => rect(top, 64);
  document.querySelector("thead")!.getBoundingClientRect = () => rect(headBottom - 44, 44);
  return row;
}

beforeEach(() => {
  scrollTo.mockClear();
  frames = [];
  reduced = false;
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.includes("reduce"), media: q }),
  });
});

afterEach(() => jest.restoreAllMocks());

const ys = () => scrollTo.mock.calls.map(([, y]) => y as number);

it("below the fold: scrolls down just enough, over 160ms on the enter curve, vertical only", () => {
  scrollRowIntoView(rowAt(780));
  const to = 500 + (780 + 64 - 800);
  runFrames(1000, 1080, 1160, 1240);
  // First frame at the start, the last at exactly 160ms later, and none after it.
  expect(ys()[0]).toBe(500);
  expect(ys()[ys().length - 1]).toBe(to);
  expect(scrollTo).toHaveBeenCalledTimes(3);
  expect(frames).toHaveLength(0);
  // Halfway in time is well past halfway in distance: the enter curve (0.2, 0.8, 0.2, 1) front-loads the motion.
  expect(ys()[1]).toBeCloseTo(500 + 44 * cubicBezier(0.2, 0.8, 0.2, 1)(0.5), 6);
  expect(ys()[1]).toBeGreaterThan(500 + 44 * 0.75);
  for (const [x] of scrollTo.mock.calls) expect(x).toBe(window.scrollX);
});

it("under the sticky header: scrolls up until the row clears it", () => {
  scrollRowIntoView(rowAt(60, 100));
  runFrames(0, 200);
  expect(ys()).toEqual([500, 460]);
});

it("already in view: does not scroll", () => {
  scrollRowIntoView(rowAt(300));
  expect(frames).toHaveLength(0);
  expect(scrollTo).not.toHaveBeenCalled();
});

it("reduced motion: instant", () => {
  reduced = true;
  scrollRowIntoView(rowAt(780));
  expect(frames).toHaveLength(0);
  expect(scrollTo).toHaveBeenCalledWith(window.scrollX, 544);
});

it("cubicBezier: linear is the identity, and the ends are pinned", () => {
  const linear = cubicBezier(0, 0, 1, 1);
  for (const p of [0, 0.25, 0.5, 0.9, 1]) expect(linear(p)).toBeCloseTo(p, 5);
  const enter = cubicBezier(0.2, 0.8, 0.2, 1);
  expect(enter(0)).toBeCloseTo(0, 6);
  expect(enter(1)).toBeCloseTo(1, 6);
});
