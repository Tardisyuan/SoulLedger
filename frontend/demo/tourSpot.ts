/**
 * Where the tour card sits when the page has verdict keys or a bar at its foot (`DemoTour.tsx`). Its own module so the
 * rule is testable without the tour's providers (`demoTourSpot.test.ts`).
 */

/** On screen and in the viewport: a sidebar slid off a phone's edge, or a page kept alive behind this one, is not. */
export function inView(el: Element | null | undefined): el is Element {
  const b = el?.getBoundingClientRect();
  return !!b && b.width > 0 && b.right > 0 && b.bottom > 0 && b.left < window.innerWidth && b.top < window.innerHeight;
}

/** A bar at the page's foot (`sticky bottom-(--bottom-bar)`: the queue's, the batch bars) or the judgment page's verdict keys. */
const BARS = "[class*='bottom-(--bottom-bar)'], [data-testid='verdict-bar']";
/**
 * The tour's own panels. Since the phone shell (ec9d3c956) the card's class is `max-md:bottom-(--bottom-bar)`, which
 * matched BARS, and DemoTour renders before the page (app/layout.tsx): the card measured itself, rose by its own height
 * on every DOM change and fell back once above the middle, so at 1280 it ended over the verdict rail, the user menu or
 * above the top of the screen, depending on how many changes the page made.
 */
const OWN = "[data-testid^='demo-tour'], [data-testid='demo-admin-hint']";

/** Offsets from the viewport's bottom and right edge; 0 = the panel's own class (`md:right-6 md:bottom-6`, phone: on the door bar). */
export type Spot = { bottom: number; right: number };
export const NO_SPOT: Spot = { bottom: 0, right: 0 };

const GAP = 12;

export function spotNow(): Spot {
  const bar = Array.from(document.querySelectorAll(BARS)).find((el) => !el.closest(OWN) && inView(el));
  if (!bar) return NO_SPOT;
  const box = bar.getBoundingClientRect();
  const w = window.innerWidth;
  const h = window.innerHeight;
  // ≥ 768 (the panel's `md:` line) and keys standing in the right half — the judgment page's rail (卷 left, 台 right):
  // the card goes beside the rail, to its left, at its usual height (fe-ia.md, 实现 10: 桌面卡位改到判栏左). Lifting it over a
  // rail that tall put it over the keys or off the top of the screen.
  if (w >= 768 && box.left >= w / 2) return { bottom: 0, right: Math.round(w - box.left + GAP) };
  // A bar across the foot (or the keys on a phone): the card stands above it.
  return box.bottom > h * 0.5 ? { bottom: Math.round(h - box.top + GAP), right: 0 } : NO_SPOT;
}

/** A state updater that keeps the old spot when nothing moved: measured on every scroll and DOM change, this saves the re-render. */
export const keep = (next: Spot) => (was: Spot) => (was.bottom === next.bottom && was.right === next.right ? was : next);

/** The inline style that puts a panel at `spot`; none when the class's own place is right. */
export const spotStyle = (spot: Spot) => (spot.bottom || spot.right ? { bottom: spot.bottom || undefined, right: spot.right || undefined } : undefined);
