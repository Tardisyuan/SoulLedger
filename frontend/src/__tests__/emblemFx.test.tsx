import { act, render } from "@testing-library/react";
import { LandingEmblem } from "@/src/components/landing/LandingEmblem";
import {
  DRAW_DONE,
  DRAW_MS,
  DRAW_WAIT,
  PARALLAX_PX,
  TILT_MAX_DEG,
  markDrawn,
  reducedMotion,
  shouldDraw,
  tiltAllowed,
  tiltFor,
  withDrawLengths,
} from "@/src/lib/emblemFx";
import { EMBLEM_SVGS } from "@/src/generated/emblemSvgs";

/** 落地页主视觉的三样效果(2026-11-09 A):倾斜的数学、只画一次、减少动态效果时全关。 */

const RECT = { left: 100, top: 50, width: 200, height: 400 };
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" class="emblem2" data-civ="x" data-theme="dark" viewBox="0 0 240 240">' +
  '<style>.emblem2[data-civ="x"] .e-l{stroke-width:6}</style><defs><radialGradient id="g"></radialGradient></defs>' +
  '<circle class="e-l" cx="120" cy="120" r="80"/><line class="e-l2" x1="0" y1="0" x2="10" y2="10"/><line class="e-t" x1="1" y1="1" x2="2" y2="2"/>' +
  '<ellipse class="e-l2 em2-wave e-l" rx="9"/><line class="e-l" style="stroke-dasharray:2 5"/><path class="e-l" pathLength="10" d="M0 0"/><line class="e-ll"/></svg>';
const parse = (text: string) => new DOMParser().parseFromString(text, "image/svg+xml").documentElement;

/** 只认括号里的单项特性:一条查询里每一项都在 `features` 里才算匹配(和浏览器对 `and` 的读法一样)。 */
function mockMedia(features: string[]) {
  const matches = (q: string) => [...q.matchAll(/\(([^)]*)\)/g)].every((m) => features.includes(m[1]));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: matches(q), media: q, addEventListener() {}, removeEventListener() {} }),
  });
}
const MOTION = "prefers-reduced-motion: no-preference";
const MOUSE = ["hover: hover", "pointer: fine"];

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("tilt follows the pointer and never passes the ceiling", () => {
  it("is flat at the centre and ±max at the edges", () => {
    expect(tiltFor(200, 250, RECT)).toEqual({ rx: 0, ry: 0, px: 0, py: 0 });
    // 右下角:右边往里倒(rotateY +),下边往里倒(rotateX −),主视觉朝指针挪。
    expect(tiltFor(300, 450, RECT)).toEqual({ rx: -TILT_MAX_DEG, ry: TILT_MAX_DEG, px: PARALLAX_PX, py: PARALLAX_PX });
    expect(tiltFor(100, 50, RECT)).toEqual({ rx: TILT_MAX_DEG, ry: -TILT_MAX_DEG, px: -PARALLAX_PX, py: -PARALLAX_PX });
    expect(tiltFor(250, 150, RECT).ry).toBe(3);
  });

  it("clamps a pointer outside the card, and a degenerate box gives no tilt", () => {
    const far = tiltFor(10_000, -10_000, RECT);
    expect(far).toEqual({ rx: TILT_MAX_DEG, ry: TILT_MAX_DEG, px: PARALLAX_PX, py: -PARALLAX_PX });
    for (const v of Object.values(tiltFor(-5, 9e9, RECT, 2))) expect(Math.abs(v)).toBeLessThanOrEqual(PARALLAX_PX);
    expect(tiltFor(5, 5, { left: 0, top: 0, width: 0, height: 10 })).toEqual({ rx: 0, ry: 0, px: 0, py: 0 });
  });
});

describe("reduced motion switches every effect off", () => {
  it("no matchMedia counts as reduced (do nothing rather than guess)", () => {
    expect(reducedMotion()).toBe(true);
    expect(tiltAllowed()).toBe(false);
  });

  it("a reduce preference: no draw, no tilt", () => {
    mockMedia(MOUSE);
    expect(reducedMotion()).toBe(true);
    expect(tiltAllowed()).toBe(false);
    expect(shouldDraw("rm-key", reducedMotion())).toBe(false);
  });

  it("a touch screen draws but does not tilt", () => {
    mockMedia([MOTION]);
    expect(reducedMotion()).toBe(false);
    expect(tiltAllowed()).toBe(false);
  });
});

describe("the draw-in: pure CSS from the first frame, once per civ", () => {
  it("a key is drawn until it is marked, then never again", () => {
    expect(shouldDraw("once-key", false)).toBe(true);
    markDrawn("once-key");
    expect(shouldDraw("once-key", false)).toBe(false);
    expect(shouldDraw("other-key", false)).toBe(true);
  });

  it("withDrawLengths gives the main lines pathLength=1 and touches nothing else", () => {
    const out = withDrawLengths(SVG);
    expect([...parse(out).querySelectorAll('[pathLength="1"]')].map((e) => e.getAttribute("class"))).toEqual(["e-l", "e-l2", "e-l2 em2-wave e-l"]);
    // 自己写了虚线或 pathLength 的不碰;去掉加的那几处就是原文。
    expect(parse(out).querySelector("path")!.getAttribute("pathLength")).toBe("10");
    expect(out.split(' pathLength="1"').join("")).toBe(SVG);
  });

  it.each(Object.keys(EMBLEM_SVGS))("%s: every solid main line gets its pathLength, and only those", (key) => {
    const svg = parse(withDrawLengths(EMBLEM_SVGS[key]));
    const lines = [...svg.querySelectorAll(".e-l, .e-l2")];
    expect(lines.length).toBeGreaterThan(0);
    for (const el of lines) expect(el.getAttribute("pathLength")).toBe(/dasharray/.test(el.outerHTML) ? null : "1");
    expect(svg.querySelectorAll("[pathLength]").length).toBe(lines.filter((el) => !/dasharray/.test(el.outerHTML)).length);
  });

  it("the markup is in the render itself, both themes, no fetch", () => {
    const view = render(<LandingEmblem civ="gr" size={88} />);
    const copies = [...view.container.querySelectorAll(".v4-emblem[data-theme]")];
    expect(copies.map((c) => c.getAttribute("data-theme"))).toEqual(["dark", "light"]);
    for (const c of copies) expect(c.querySelector(`svg.emblem2[data-civ="gr"][data-theme="${c.getAttribute("data-theme")}"]`)).not.toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
  });

  describe("once JS is there", () => {
    const svgs = (root: HTMLElement) => [...root.querySelectorAll("svg.emblem2")];
    const all = (root: HTMLElement, c: string) => svgs(root).every((s) => s.classList.contains(c));
    const none = (root: HTMLElement, c: string) => svgs(root).every((s) => !s.classList.contains(c));
    let observers: { cb: IntersectionObserverCallback; disconnected: boolean }[];
    let rect: jest.SpyInstance<DOMRect, []>;

    beforeEach(() => {
      rect = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect");
      jest.useFakeTimers();
      observers = [];
      Object.assign(window, {
        IntersectionObserver: jest.fn((cb: IntersectionObserverCallback) => {
          const o = { cb, disconnected: false };
          observers.push(o);
          return { observe() {}, disconnect: () => void (o.disconnected = true), unobserve() {}, takeRecords: () => [] };
        }),
      });
      mockMedia([MOTION, ...MOUSE]);
    });
    afterEach(() => {
      jest.useRealTimers();
      rect.mockRestore();
      delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
    });
    const at = (top: number) => rect.mockReturnValue({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON() {} } as DOMRect);

    it("on screen at load: left drawing, marked done after it, not redrawn on re-render or remount", () => {
      at(10);
      const view = render(<LandingEmblem civ="eu" size={88} />);
      expect(none(view.container, DRAW_WAIT)).toBe(true);
      expect(none(view.container, DRAW_DONE)).toBe(true);
      act(() => void jest.advanceTimersByTime(DRAW_MS));
      expect(all(view.container, DRAW_DONE)).toBe(true);

      const same = svgs(view.container)[0];
      view.rerender(<LandingEmblem civ="eu" size={88} className="x" />);
      expect(svgs(view.container)[0]).toBe(same);
      expect(all(view.container, DRAW_DONE)).toBe(true);

      view.unmount();
      const again = render(<LandingEmblem civ="eu" size={88} />);
      expect(all(again.container, DRAW_DONE)).toBe(true);
    });

    it("off screen at load: waits, then draws when it comes into view", () => {
      at(5000);
      const view = render(<LandingEmblem civ="cn" size={88} />);
      expect(all(view.container, DRAW_WAIT)).toBe(true);
      const open = observers.filter((o) => !o.disconnected);
      act(() => open[open.length - 1].cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(view.container.querySelector("[data-paused]")).not.toBeNull();
      expect(all(view.container, DRAW_WAIT)).toBe(true);
      act(() => open[open.length - 1].cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(view.container.querySelector("[data-paused]")).toBeNull();
      expect(none(view.container, DRAW_WAIT)).toBe(true);
      expect(none(view.container, DRAW_DONE)).toBe(true);
      act(() => void jest.advanceTimersByTime(DRAW_MS));
      expect(all(view.container, DRAW_DONE)).toBe(true);
    });

    it("reduced motion: done from the start, nothing waits", () => {
      mockMedia(MOUSE);
      at(5000);
      const view = render(<LandingEmblem civ="eg" size={88} />);
      expect(all(view.container, DRAW_DONE)).toBe(true);
      expect(none(view.container, DRAW_WAIT)).toBe(true);
    });
  });
});
