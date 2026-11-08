import { act, render } from "@testing-library/react";
import { LandingEmblem } from "@/src/components/landing/LandingEmblem";
import {
  DRAW_MS,
  PARALLAX_PX,
  TILT_MAX_DEG,
  finishDraw,
  markDrawn,
  primeDraw,
  reducedMotion,
  shouldDraw,
  tiltAllowed,
  tiltFor,
} from "@/src/lib/emblemFx";

/** 落地页主视觉的三样效果(2026-11-09 A):倾斜的数学、只画一次、减少动态效果时全关。 */

const RECT = { left: 100, top: 50, width: 200, height: 400 };
const SVG = (civ: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="emblem2" data-civ="${civ}" data-theme="dark" viewBox="0 0 240 240">` +
  `<style>.emblem2[data-civ="${civ}"] .e-l{stroke-width:6}</style>` +
  '<circle class="e-l" cx="120" cy="120" r="80"/><line class="e-l2" x1="0" y1="0" x2="10" y2="10"/><line class="e-t" x1="1" y1="1" x2="2" y2="2"/></svg>';
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
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

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

describe("the draw-in runs once", () => {
  it("a key is drawn until it is marked, then never again", () => {
    expect(shouldDraw("once-key", false)).toBe(true);
    markDrawn("once-key");
    expect(shouldDraw("once-key", false)).toBe(false);
    expect(shouldDraw("other-key", false)).toBe(true);
  });

  it("prime sets pathLength on the main lines only, finish leaves the file as it was", () => {
    const svg = parse(SVG("x"));
    const before = svg.outerHTML;
    primeDraw(svg);
    expect(svg.classList.contains("fx-pre")).toBe(true);
    expect([...svg.querySelectorAll("[pathLength]")].map((e) => e.getAttribute("class"))).toEqual(["e-l", "e-l2"]);
    svg.classList.add("fx-run");
    finishDraw(svg);
    expect(svg.outerHTML).toBe(before);
  });

  it("LandingEmblem draws on first sight, not on re-render, remount or a second theme", async () => {
    mockMedia([MOTION, ...MOUSE]);
    const observers: { cb: IntersectionObserverCallback; disconnected: boolean }[] = [];
    const IO = jest.fn((cb: IntersectionObserverCallback) => {
      const o = { cb, disconnected: false };
      observers.push(o);
      return { observe() {}, disconnect: () => void (o.disconnected = true), unobserve() {}, takeRecords: () => [] };
    });
    Object.assign(window, { IntersectionObserver: IO });
    Object.assign(globalThis, {
      fetch: jest.fn(async (url: string) => ({ ok: true, text: async () => SVG(url.includes("-cn-") ? "cn" : "eu") })),
    });
    jest.useFakeTimers();
    try {
      const view = render(<LandingEmblem civ="cn" size={88} />);
      await flush();
      const svg = () => view.container.querySelector("svg.emblem2")!;
      expect(svg()).not.toBeNull();
      // 进视口之前:主线藏着,还没开画。
      expect(svg().classList.contains("fx-pre")).toBe(true);
      expect(svg().classList.contains("fx-run")).toBe(false);
      expect(view.container.querySelector("[data-paused]")).not.toBeNull();

      const open = observers.filter((o) => !o.disconnected);
      const live = open[open.length - 1];
      act(() => live.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(view.container.querySelector("[data-paused]")).toBeNull();
      act(() => void jest.advanceTimersByTime(20));
      expect(svg().classList.contains("fx-run")).toBe(true);
      act(() => void jest.advanceTimersByTime(DRAW_MS));
      expect(svg().classList.contains("fx-pre")).toBe(false);
      expect(svg().querySelector("[pathLength]")).toBeNull();

      // 重渲染:同一份图,不重画。
      const same = svg();
      view.rerender(<LandingEmblem civ="cn" size={88} className="x" />);
      expect(svg()).toBe(same);
      expect(svg().classList.contains("fx-pre")).toBe(false);

      // 卸了再挂(换主题换出的另一份图同理):已经画过,直接整图。
      view.unmount();
      const again = render(<LandingEmblem civ="cn" size={88} />);
      await flush();
      expect(again.container.querySelector("svg.emblem2")!.classList.contains("fx-pre")).toBe(false);
      again.unmount();
    } finally {
      jest.useRealTimers();
      delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  });

  it("reduced motion: the emblem is whole from the first frame", async () => {
    mockMedia(MOUSE);
    Object.assign(window, { IntersectionObserver: jest.fn(() => ({ observe() {}, disconnect() {} })) });
    Object.assign(globalThis, { fetch: jest.fn(async () => ({ ok: true, text: async () => SVG("eg") })) });
    try {
      const view = render(<LandingEmblem civ="eg" size={88} />);
      await flush();
      const svg = view.container.querySelector("svg.emblem2")!;
      expect(svg).not.toBeNull();
      expect(svg.classList.contains("fx-pre")).toBe(false);
      expect(svg.querySelector("[pathLength]")).toBeNull();
      view.unmount();
    } finally {
      delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  });

  it("without fetch it falls back to the <img> emblem", () => {
    const view = render(<LandingEmblem civ="gr" size={88} />);
    expect(view.container.querySelector("img[src='/v4/emblems/soulledger-emblem-gr-dark.svg']")).not.toBeNull();
    expect(view.container.querySelector("svg")).toBeNull();
  });
});
