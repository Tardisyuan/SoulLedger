/**
 * Where the tour card goes (`demo/tourSpot.ts`). The phone shell gave the card the class `max-md:bottom-(--bottom-bar)`,
 * the very pattern the card looked for to find a bar at the page's foot; DemoTour renders before the page, so the card
 * found itself first and climbed by its own height on each DOM change — over the verdict keys, the user menu, or past the
 * top of the screen (demo E2E, 2026-11-14). And at 1280 the judgment page's keys are a tall rail on the right: the card
 * goes beside it, not above it.
 */
import { NO_SPOT, keep, spotNow, spotStyle } from "@/demo/tourSpot";

type Box = { left: number; top: number; width: number; height: number };

function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function place(el: Element, { left, top, width, height }: Box) {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

/** The tour card as DemoTour draws it (before the page), at the bottom right of a 1280 × 800 screen. */
function tourCard(): HTMLElement {
  const card = document.createElement("aside");
  card.dataset.testid = "demo-tour";
  card.className = "fixed z-toast max-md:inset-x-0 max-md:bottom-(--bottom-bar) md:right-6 md:bottom-6 md:w-90";
  document.body.appendChild(card);
  place(card, { left: 896, top: 516, width: 360, height: 260 });
  return card;
}

function element(testid: string | null, className: string, box: Box): HTMLElement {
  const el = document.createElement("div");
  if (testid) el.dataset.testid = testid;
  el.className = className;
  document.body.appendChild(el);
  place(el, box);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  viewport(1280, 800);
});

test("the card does not take itself for a bar at the page's foot", () => {
  tourCard();
  expect(spotNow()).toBe(NO_SPOT);
});

test("nor its folded strip, the badge or the administrator's hint", () => {
  for (const id of ["demo-tour-badge", "demo-admin-hint"]) element(id, "fixed max-md:bottom-(--bottom-bar)", { left: 900, top: 700, width: 300, height: 60 });
  expect(spotNow()).toBe(NO_SPOT);
});

test("1280: the verdict rail on the right — the card sits to its left, at its own height, whatever comes first", () => {
  tourCard();
  element("verdict-bar", "grid grid-cols-1 gap-2", { left: 880, top: 300, width: 376, height: 260 });
  expect(spotNow()).toEqual({ bottom: 0, right: 1280 - 880 + 12 });
});

test("1280: a bar across the foot (the queue's) — the card stands above it", () => {
  tourCard();
  element(null, "sticky bottom-(--bottom-bar) border-t", { left: 240, top: 720, width: 1040, height: 80 });
  expect(spotNow()).toEqual({ bottom: 800 - 720 + 12, right: 0 });
});

test("393: the verdict keys are across the page — the card stands above them, never to their side", () => {
  viewport(393, 852);
  element("verdict-bar", "grid grid-cols-1 gap-2", { left: 16, top: 520, width: 361, height: 240 });
  expect(spotNow()).toEqual({ bottom: 852 - 520 + 12, right: 0 });
});

test("keys scrolled out of view, or a bar in the top half, move nothing", () => {
  element("verdict-bar", "grid grid-cols-1 gap-2", { left: 16, top: 900, width: 600, height: 240 });
  element(null, "sticky bottom-(--bottom-bar)", { left: 0, top: 100, width: 1280, height: 60 });
  expect(spotNow()).toBe(NO_SPOT);
});

test("an unchanged spot keeps the same object (no re-render per scroll); the style is only for a moved card", () => {
  const was = { bottom: 92, right: 0 };
  expect(keep({ bottom: 92, right: 0 })(was)).toBe(was);
  expect(keep({ bottom: 0, right: 412 })(was)).toEqual({ bottom: 0, right: 412 });
  expect(spotStyle(NO_SPOT)).toBeUndefined();
  expect(spotStyle({ bottom: 0, right: 412 })).toEqual({ bottom: undefined, right: 412 });
});
