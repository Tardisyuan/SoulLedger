"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@soulledger/core/api/client";
import { MOTION_DURATIONS, MOTION_EASINGS, prefersReducedMotion } from "@/lib/motion";
import { Button } from "@/src/components/ui/Button";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { BRAND_WORD } from "@/src/components/layout/GlobalNav";
import { Seal } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import stats from "@/src/config/landing-stats.json";
import { ENTERED, ENTRANCE, type EntranceDetail, ROLE_OF_SKIN, SKINS, TOUR_KEY, useEnter } from "./DemoEntrances";
import { OverreachProbe } from "./OverreachProbe";
import { AssistGuardCard } from "./AssistGuardCard";
import { DEMO_USERNAMES } from "./store";
import type { Tour } from "./tour";

/** Where the visitor is in the tour. In the tab, so a refresh keeps it and a new tab starts fresh, like the rest of the demo. */
type State = { step: number; collapsed: boolean; finished: boolean; skipped: boolean; closed: boolean };
const START: State = { step: 0, collapsed: false, finished: false, skipped: false, closed: false };

function load(): State {
  try {
    return { ...START, ...JSON.parse(sessionStorage.getItem(TOUR_KEY) ?? "{}") };
  } catch {
    return START;
  }
}

function save(state: State): void {
  try {
    sessionStorage.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {
    /* no storage: the tour simply starts over on a reload */
  }
}

/**
 * The way in (v4; Design drew no motion for it, so it is built from the v4 tokens and the v4 band): the card that was
 * clicked opens into a cover that looks like the console's identity band (canvas and the civilization's glow and
 * pattern, the seal in its own ink), and its emblem becomes the seal at the centre. Once the console is drawn under it,
 * the cover closes onto the real band's box and the seal onto the real band's seal, measured, so the hand-over is one
 * motion and not a jump; then the cover fades and the real band is what stays. The administrator has no seal: the
 * brand's mark goes to the sidebar's. Reduced motion: the cover only fades in and out.
 */
const STYLES = `.demo-tour-target{outline:2px solid oklch(var(--color-main));outline-offset:4px;box-shadow:0 0 0 8px color-mix(in srgb,oklch(var(--color-main)) 16%,transparent);scroll-margin-top:9.5rem}
body:has([data-testid='demo-tour']:not([data-finished])) main{padding-bottom:max(45vh,22rem)}
@keyframes demo-seal-out{to{opacity:0}}
@keyframes demo-seal-in{from{opacity:0}}
.demo-entrance{position:fixed;inset:0;z-index:9999;color:oklch(var(--color-ink))}
.demo-cover{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:hidden;background-color:oklch(var(--color-canvas));background-image:radial-gradient(60% 180px at 24% 0%,color-mix(in srgb,oklch(var(--color-glow)) calc(var(--glowA) * 100%),transparent),transparent 72%)}
.demo-seal-mark{position:fixed;left:0;top:0;transform-origin:0 0;will-change:transform;line-height:0}
.demo-seal-name{position:absolute;left:50%;top:calc(50% + 56px);transform:translateX(-50%);animation:demo-seal-in var(--transition-duration-base) var(--ease-enter) 160ms both}
.demo-seal-skip{position:fixed;top:8px;right:8px}
[data-land] .demo-seal-skip{animation:demo-seal-out 120ms var(--ease-exit) forwards}
[data-land] .demo-seal-name{animation:none}
@media (prefers-reduced-motion:reduce){.demo-entrance{animation:demo-seal-in 150ms ease-out both}.demo-entrance>:not(.demo-cover):not(.sr-only),.demo-seal-name{display:none}}`;

/** A page kept alive behind the current one is still in the document, with its own `main`, and takes up no room. */
const onScreen = (element: Element) => element.getClientRects().length > 0;

function findTarget(css?: string, text?: string, up?: string): Element | null {
  // In the order written, not document order: the row before the card that contains it.
  for (const selector of css?.split(/,\s*/) ?? []) {
    const found = Array.from(document.querySelectorAll(selector)).find(onScreen);
    if (found) return found;
  }
  if (!text) return null;
  const main = Array.from(document.querySelectorAll("main")).find(onScreen);
  const rows = main ? Array.from(main.querySelectorAll("tr, li, article")) : [];
  const row = rows.find((candidate) => candidate.textContent?.includes(text)) ?? null;
  return (up && row?.closest(up)) || row;
}

function covered(target: Element): boolean {
  const card = document.querySelector("[data-testid='demo-tour']")?.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  return !!card && box.bottom > card.top && box.top < card.bottom && box.right > card.left && box.left < card.right;
}

/** Centred if the card leaves it clear, otherwise at the top: the page has room to spare below it while the card is up (STYLES). */
function reveal(target: Element): void {
  target.scrollIntoView({ block: "center", behavior: "auto" });
  if (covered(target)) target.scrollIntoView({ block: "start", behavior: "auto" });
}

/** After the card has moved: scroll only if it now sits on the target. */
function revealIfCovered(target: Element): void {
  if (covered(target)) target.scrollIntoView({ block: "start", behavior: "auto" });
}

/** How far the card sits up: above the verdict bar when the page has one at its foot. */
function liftNow(): number {
  const bar = document.querySelector("[class*='bottom-(--bottom-bar)'], [data-testid='verdict-bar']");
  const box = bar?.getBoundingClientRect();
  return box && box.top < window.innerHeight && box.bottom > window.innerHeight * 0.5 ? window.innerHeight - box.top + 12 : 0;
}

/** When the cover may start to close: after the seal has come to the centre, and once the page under it is drawn. */
const LANDED_MS = 450;
/** Never hold the cover longer than this: a sign-in that went nowhere (an error) still lets the page show. */
// ponytail: a fixed cap, not a signal from `enter`; a phone that takes longer than this sees the landing page again.
const HOLD_MAX_MS = 6000;
/** Still waiting: a route's loading slot (`PageSpinner` / `CivLoading`) or the permission gate. */
const WAITING = "[data-civ-loading], [data-testid='permissions-pending']";
/** The seal's width while it stands at the centre; it is scaled from and to the measured marks at either end. */
const MARK = 96;

const ms = (d: keyof typeof MOTION_DURATIONS) => MOTION_DURATIONS[d] * 1000;
const curve = (e: keyof typeof MOTION_EASINGS) => `cubic-bezier(${MOTION_EASINGS[e].join(",")})`;

/** On screen and in the viewport: a sidebar slid off a phone's edge, or a page kept alive behind this one, is not. */
function inView(el: Element | null | undefined): el is Element {
  const b = el?.getBoundingClientRect();
  return !!b && b.width > 0 && b.right > 0 && b.bottom > 0 && b.left < window.innerWidth && b.top < window.innerHeight;
}
const firstInView = (css: string) => Array.from(document.querySelectorAll(css)).find(inView) ?? null;

/**
 * The console's page head (第三十批: 顶线 + 卷宗头, which replaced the identity band), and the mark the seal lands on: the
 * sidebar's hall seal, or with no underworld the sidebar's brand mark. The page head carries no seal of its own any more.
 */
function handOffTargets(sealed: boolean): { band: Element | null; mark: Element | null } {
  const band = firstInView("[data-testid='page-head']");
  const mark = sealed ? firstInView(".nav-hall-card [data-testid='seal']") : firstInView("[data-nav-brand] [data-brand-mark]");
  return { band, mark: inView(mark) ? mark : null };
}

type Box = { x: number; y: number; w: number; h: number; r: number };
const boxFrame = (b: Box): Keyframe => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: `${b.r}px` });
const viewport = (): Keyframe => boxFrame({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight, r: 0 });
/** The seal element (MARK wide) drawn over a box: moved to its corner and scaled to its width. */
const over = (b: { x: number; y: number; w: number }) => `translate(${b.x}px, ${b.y}px) scale(${b.w / MARK})`;

/** Where the seal stands while the cover is up: the middle of the viewport, a little above centre for its name below. */
const centreOf = (el: HTMLElement) => ({ x: (window.innerWidth - el.offsetWidth) / 2, y: (window.innerHeight - el.offsetHeight) / 2 - 16, w: MARK });
const lerp = (a: number, b: number, e: number) => a + (b - a) * e;

/**
 * The seal on the way in. It holds until the new route is on screen and done waiting (two frames in a row with no
 * loading slot), so the console is already under it when it closes: a timer alone left the landing page up for a second.
 *
 * The same cover goes from one underworld to another (the finished tour's other seals). While it is up, the root
 * carries `data-civ-change="covered"` and `TenantContext` skips its cross-fade: that fade froze the old page and faded
 * it into the old page in the new colours, and the new page cut in half a second to a second later.
 */
function EntranceOverlay() {
  const { t } = useI18n();
  const [run, setRun] = useState<(EntranceDetail & { at: number }) | null>(null);
  const [land, setLand] = useState(false);
  const target = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const start = (e: Event) => {
      const detail = (e as CustomEvent<EntranceDetail>).detail;
      // Before the sign-in answers and changes the civilization: set here, not in an effect a frame later.
      document.documentElement.dataset.civChange = "covered";
      target.current = null;
      setLand(false);
      setRun({ ...detail, at: performance.now() });
    };
    const entered = (e: Event) => {
      target.current = ((e as CustomEvent).detail as { route: string }).route;
    };
    window.addEventListener(ENTRANCE, start);
    window.addEventListener(ENTERED, entered);
    return () => {
      window.removeEventListener(ENTRANCE, start);
      window.removeEventListener(ENTERED, entered);
    };
  }, []);

  useEffect(() => {
    if (!run) return;
    document.documentElement.dataset.civChange = "covered";
    const end = () => setRun(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.civChange;
    };
  }, [run]);

  // Opening: the card's box grows to the viewport, and its emblem moves to the centre and becomes the seal.
  useLayoutEffect(() => {
    const el = mark.current;
    const box = cover.current;
    if (!run || !el || !box) return;
    // A cover started again before the last one went keeps its element and what the closing wrote on it.
    box.removeAttribute("style");
    root.current?.style.removeProperty("opacity");
    el.style.removeProperty("opacity");
    label.current?.style.removeProperty("opacity");
    const centre = centreOf(el);
    el.style.transform = over(centre);
    if (prefersReducedMotion() || typeof box.animate !== "function") return;
    const anims: Animation[] = [];
    if (run.from) anims.push(box.animate([boxFrame(run.from), viewport()], { duration: ms("base"), easing: curve("enter") }));
    const from = run.mark ?? (run.from ? { x: run.from.x + run.from.w / 2 - 12, y: run.from.y + run.from.h / 2 - 12, w: 24 } : centre);
    anims.push(
      el.animate(
        [
          { transform: over(from), opacity: 0 },
          { transform: over(centre), opacity: 1 },
        ],
        { duration: ms("slow"), easing: curve("drop") },
      ),
    );
    return () => anims.forEach((a) => a.cancel());
  }, [run]);

  // Checked every frame rather than on events: "the page is drawn" has no event, and this lasts a second at most.
  useEffect(() => {
    if (!run || land) return;
    let frame = 0;
    let ready = 0;
    let lastBand = "";
    const check = () => {
      const held = performance.now() - run.at;
      // The route `enter` pushed, not merely another one: from one hall to the next the path may not change at all.
      const arrived = target.current !== null && window.location.pathname === target.current && !document.querySelector(WAITING);
      // And its band at rest: one that is still collapsing or opening (44 ↔ 76 on a phone) is not where the seal goes.
      const b = handOffTargets(run.skin !== null).band?.getBoundingClientRect();
      const band = b ? `${Math.round(b.top)}/${Math.round(b.height)}` : "";
      const still = band === lastBand;
      lastBand = band;
      ready = arrived && still ? ready + 1 : 0;
      // Two frames in a row: the page has painted once with its data, not just mounted.
      if ((held >= LANDED_MS && ready >= 2) || held >= HOLD_MAX_MS) setLand(true);
      else frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [run, land]);

  // Closing: the cover onto the real band, the seal onto the real seal; then the cover fades over the band it now matches.
  // Frame by frame towards the targets measured on that frame, not to a box measured once: the band can still move while
  // it closes (the tour scrolls its first step into view, and a scrolled band shrinks to 44), and the seal would jump.
  // The cover has the band cut out of it from the first frame: the real band (its title, its court) is already drawn
  // where it will stay, and only its seal is held back until the cover's seal is on it. The name rides in the cover, so
  // it is clipped with it and never lies over the console.
  // Before the paint that first shows `data-land`: a frame of the uncut cover over the drawn band is what this avoids.
  useLayoutEffect(() => {
    const el = mark.current;
    const box = cover.current;
    const all = root.current;
    if (!land || !run || !el || !box || !all) return;
    let frame = 0;
    const reduced = prefersReducedMotion();
    const t0 = performance.now();
    // The name fades first (120 ms, on the same clock as the rest, so it is gone when the cover starts to close), on the
    // cover and nowhere else; then the cover closes.
    // 120 + 240 + 120: no longer in all than before the name waited, which a slow phone (CPU x4) only just fits.
    const wait = reduced ? 0 : 120;
    const move = reduced ? 0 : ms("base");
    const fade = reduced ? 150 : 120;
    const from = centreOf(el);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let held: HTMLElement | SVGElement | null = null;
    const hold = (real: Element | null) => {
      if (held === real) return;
      held?.style.removeProperty("visibility");
      held = real instanceof HTMLElement || real instanceof SVGElement ? real : null;
      held?.style.setProperty("visibility", "hidden");
    };
    // performance.now(), not the frame's timestamp: that can be earlier than t0, and a negative progress overshoots.
    let p = 0;
    let e = 0;
    // The band can also change size inside a frame (a phone's band opens from 44 to its full height as the page settles):
    // a resize observer runs after layout and before paint, so the cut-out is redrawn in that same frame.
    let watched: Element | null = null;
    let resized: ResizeObserver | null = null;
    const place = () => {
      if (!reduced) {
        const { band, mark: real } = handOffTargets(run.skin !== null);
        if (band !== watched && resized) {
          resized.disconnect();
          if (band) resized.observe(band);
          watched = band;
        }
        if (band) {
          const b = band.getBoundingClientRect();
          const c = { x: lerp(0, b.left, e), y: lerp(0, b.top, e), w: lerp(vw, b.width, e), h: lerp(vh, b.height, e) };
          Object.assign(box.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
          // The band's box in the cover's own coordinates, cut out (even-odd: the outer rectangle minus the inner one).
          const hole = `M${b.left - c.x} ${b.top - c.y}h${b.width}v${b.height}h${-b.width}Z`;
          box.style.clipPath = `path(evenodd, "M0 0H${c.w}V${c.h}H0Z${hole}")`;
        } else box.style.opacity = String(1 - e);
        if (real) {
          const m = real.getBoundingClientRect();
          el.style.transform = over({ x: lerp(from.x, m.left, e), y: lerp(from.y, m.top, e), w: lerp(from.w, m.width, e) });
        } else el.style.opacity = String(1 - e);
        // The band's own seal shows once the cover's is on it; until then there would be two.
        hold(p < 1 ? real : null);
      }
    };
    if (typeof ResizeObserver === "function") resized = new ResizeObserver(place);
    const tick = () => {
      const now = performance.now();
      label.current?.style.setProperty("opacity", String(wait ? Math.max(0, 1 - (now - t0) / wait) : 0));
      p = Math.min(1, Math.max(0, (now - t0 - wait) / (move || 1)));
      // ponytail: a quartic ease-out standing in for `standard` (0.2, 0, 0, 1); a bezier solver if anyone can tell.
      e = move ? 1 - (1 - p) ** 4 : 1;
      place();
      const f = Math.min(1, Math.max(0, (now - t0 - wait - move) / fade));
      all.style.opacity = String(1 - f);
      if (f >= 1) setRun(null);
      else frame = requestAnimationFrame(tick);
    };
    tick();
    // The tour scrolls its first step into view while this closes: scroll events come before the frame's callbacks, so
    // the cut-out follows the band in the same frame rather than one behind it.
    window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", place, { capture: true });
      resized?.disconnect();
      hold(null);
    };
  }, [land, run]);

  if (!run) return null;
  // No underworld (the administrator): the brand's mark on the canvas, in ink, instead of a court's seal.
  const name = run.skin ? t(`demo.civ.${run.skin}.name`) : BRAND_WORD;
  return (
    // A click anywhere skips it; Esc does the same, on the window, and the 跳过 button is the keyboard's way.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={root}
      data-testid="demo-entrance"
      data-civ={run.skin ?? undefined}
      data-neutral={run.skin ? undefined : ""}
      data-land={land ? "" : undefined}
      onClick={() => setRun(null)}
      className="demo-entrance"
    >
      <div ref={cover} className="demo-cover">
        <div aria-hidden="true" className="page-head-pat" />
        <span ref={label} className="demo-seal-name whitespace-nowrap font-title text-lg">{name}</span>
      </div>
      <span aria-live="polite" className="sr-only">{t("demo.enter.entering", { civ: name })}</span>
      <span ref={mark} className="demo-seal-mark">
        {run.skin ? <Seal size={MARK} civ={run.skin} glyphs={null} court={name} /> : <BrandMark size={MARK} />}
      </span>
      <button type="button" onClick={() => setRun(null)} className="demo-seal-skip h-11 min-w-11 px-3 text-sm">
        {t("demo.enter.skip")}
      </button>
    </div>
  );
}

/** Right-hand corner on a desktop, the bottom edge on a phone; no scrim, and it folds down to a chip. */
export default function DemoTour() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { enter, warm } = useEnter();
  const pathname = usePathname();
  const router = useRouter();
  const [tour, setTour] = useState<Tour | null>(null);
  const [state, setState] = useState<State>(START);
  const [lift, setLift] = useState(0);
  const username = user?.username ?? null;

  // Every entrance, not only a change of user: re-entering as the same role from the home page (the administrator,
  // first on the guard tour and then from the roles row) keeps the username, and kept the earlier answer with it.
  const [entries, setEntries] = useState(0);
  useEffect(() => {
    const again = () => setEntries((n) => n + 1);
    window.addEventListener(ENTERED, again);
    return () => window.removeEventListener(ENTERED, again);
  }, []);

  useEffect(() => {
    setState(load());
    if (!username) {
      setTour(null);
      return;
    }
    let live = true;
    api.get<Tour | null>("/demo/tour/").then(
      (res) => live && setTour(res.data && "steps" in res.data ? res.data : null),
      () => live && setTour(null),
    );
    return () => {
      live = false;
    };
  }, [username, entries]);

  const step = tour?.steps[state.step];
  const here = !!step && pathname === step.route;
  const showing = !state.collapsed && !state.finished && !state.closed;

  // The step's target, while lit: a later lift of the card scrolls it clear only if the card now covers it.
  const lit = useRef<Element | null>(null);

  useEffect(() => {
    if (!here || !showing) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (step?.tab) {
        const label = t(step.tab);
        // A tab, or a segment of a segmented control (the permissions page's 矩阵 / 角色).
        const tab = Array.from(document.querySelectorAll<HTMLElement>("[role='tab'], [role='radio']")).find((el) => onScreen(el) && el.textContent?.includes(label));
        if (tab && tab.getAttribute("aria-selected") !== "true" && tab.getAttribute("aria-checked") !== "true") {
          tab.click();
          // Looked for on the next tick: until React draws the opened tab, the selector still finds the old tab's table.
          tries += 1;
          if (tries > 25) clearInterval(timer);
          return;
        }
      }
      const found = findTarget(step?.css, step?.text, step?.up);
      tries += 1;
      if (found) {
        lit.current = found;
        found.classList.add("demo-tour-target");
        // The card where it will sit first, then one scroll. It used to scroll, let the card move up (lift was
        // measured every 300 ms) and scroll again 350 ms later: the page jumped twice.
        flushSync(() => setLift(liftNow()));
        reveal(found);
      }
      if (lit.current || tries > 25) clearInterval(timer);
    }, 120);
    return () => {
      clearInterval(timer);
      lit.current?.classList.remove("demo-tour-target");
      lit.current = null;
    };
  }, [here, step, showing, t]);

  // The verdict keys are what the page is for: the card sits above the bar that holds them. Measured when the page
  // changes (the bar mounts, a tab opens), coalesced to a frame, instead of on a 300 ms poll that moved the card late.
  useEffect(() => {
    if (!showing) {
      setLift(0);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLift(liftNow()));
    };
    measure();
    const watcher = new MutationObserver(measure);
    watcher.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [showing, pathname]);

  useEffect(() => {
    if (lit.current && lift) revealIfCovered(lit.current);
  }, [lift]);

  // Whatever panel is up publishes how much of the viewport bottom it takes (`--demo-tour-h` on :root), so a fixed-bottom
  // card elsewhere (the map's station card at 393, the overview's padding) sits above it instead of over its buttons.
  // No panel → the variable is removed and those offsets fall back to 0. Every render: the panel changes with state and lift.
  const panelRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = panelRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--demo-tour-h");
      return;
    }
    const publish = () =>
      root.style.setProperty("--demo-tour-h", `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`);
    publish();
    const resized = typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    resized?.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      resized?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--demo-tour-h");
    };
  });

  const update = (next: Partial<State>) => {
    const merged = { ...state, ...next };
    save(merged);
    setState(merged);
  };
  const go = (index: number) => {
    update({ step: index });
    if (tour) router.push(tour.steps[index].route);
  };

  const outside = pathname === "/" || pathname.startsWith("/login");
  const panel =
    "fixed z-toast border border-[oklch(var(--color-line-strong))] border-t-3 border-t-[oklch(var(--color-main))] bg-[oklch(var(--color-surface-1))] p-4 shadow-overlay max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[40vh] max-md:overflow-y-auto md:right-6 md:bottom-6 md:w-90";
  let card = null;
  if (tour && step && !outside && !state.closed) {
    // 「系统怎么保护自己」 belongs to no underworld: its own title and ending, and the four seals all stay on offer.
    const guard = tour.skin === "guard";
    const civ = guard ? "" : t(`demo.civ.${tour.skin}.name`);
    const total = tour.steps.length;
    if (state.finished) {
      const done = guard ? ["demo.tour.guard.done_title", t("demo.tour.guard.done_body")] : ["demo.tour.done_title", t("demo.tour.done_body", { civ })];
      card = (
        <aside ref={panelRef} data-testid="demo-tour" data-finished="" className={panel}>
          <p className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t(state.skipped ? "demo.tour.skipped_title" : done[0])}</p>
          <p className="mt-1 mb-0 text-sm text-[oklch(var(--color-ink-muted))]">{state.skipped ? t("demo.tour.skipped_body") : done[1]}</p>
          <ul className="m-0 mt-3 flex list-none gap-2 p-0">
            {SKINS.filter((skin) => skin !== tour.skin).map((skin) => (
              <li key={skin} data-civ={skin}>
                <button
                  type="button"
                  data-testid={`demo-tour-other-${skin}`}
                  aria-label={t("demo.landing.card_label", { civ: t(`demo.civ.${skin}.name`) })}
                  onClick={(e) => void enter(ROLE_OF_SKIN[skin], e.currentTarget)}
                  onPointerEnter={() => warm(ROLE_OF_SKIN[skin])}
                  onFocus={() => warm(ROLE_OF_SKIN[skin])}
                >
                  <Seal size={36} civ={skin} glyphs={null} court={t(`demo.civ.${skin}.name`)} />
                </button>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[oklch(var(--color-ink))]">
            <a data-testid="demo-tour-how-built" href="/#how-built" className="underline underline-offset-2">{t("demo.build.title")}</a>
            <a href={stats.github} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t("demo.build.github")}</a>
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => router.push("/")}>{t("demo.tour.try_another")}</Button>
            <Button type="button" variant="ghost" size="sm" data-testid="demo-tour-stay" onClick={() => update({ closed: true })}>{t("demo.tour.stay")}</Button>
          </div>
        </aside>
      );
    } else if (state.collapsed) {
      card = (
        <button
          type="button"
          ref={panelRef as RefObject<HTMLButtonElement | null>}
          data-testid="demo-tour-badge"
          onClick={() => update({ collapsed: false })}
          className="fixed right-3 bottom-3 z-toast h-11 border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-3 text-xs text-[oklch(var(--color-ink))] max-md:bottom-20 md:right-6 md:bottom-6"
        >
          {t("demo.tour.chip", { n: String(state.step + 1), total: String(total) })} <span aria-hidden="true">▴</span>
        </button>
      );
    } else {
      const last = state.step === total - 1;
      card = (
        <aside ref={panelRef} data-testid="demo-tour" data-civ={guard ? undefined : tour.skin} data-tour={tour.skin} className={panel} style={lift ? { bottom: lift } : undefined}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-[oklch(var(--color-ink-muted))]">{guard ? t("demo.tour.guard.title") : t("demo.tour.title_civ", { civ })}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid="demo-tour-progress" className="font-mono text-xs text-[oklch(var(--color-ink))]">{state.step + 1} / {total}</span>
              <button type="button" data-testid="demo-tour-collapse" aria-label={t("demo.tour.collapse")} onClick={() => update({ collapsed: true })} className="h-6 min-w-6 text-sm text-[oklch(var(--color-ink-muted))]">—</button>
            </span>
          </div>
          <div aria-hidden="true" className="mt-2 flex gap-1">
            {tour.steps.map((s, i) => (
              <span key={s.n} className="h-1 flex-1" style={{ background: i <= state.step ? "oklch(var(--color-main))" : "oklch(var(--color-line))" }} />
            ))}
          </div>
          <p className="mt-3 mb-0 font-title text-lg text-[oklch(var(--color-ink))]">{t(`demo.tour.${tour.skin}.${step.n}.name`)}</p>
          <p className="mt-1 mb-0 text-sm text-[oklch(var(--color-ink-muted))]">{t(`demo.tour.${tour.skin}.${step.n}.body`)}</p>
          <p className="mt-2 mb-0 text-xs text-[oklch(var(--color-ink-subtle))]">{t("demo.tour.look_here", { target: t(`demo.tour.target.${step.target}`) })}</p>
          {step.probe && here ? <OverreachProbe key={step.n} /> : null}
          {step.assist && here ? <AssistGuardCard key={step.n} /> : null}
          <div className="mt-3 flex items-center justify-between gap-2">
            {state.step > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => go(state.step - 1)}>{t("demo.tour.prev")}</Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" data-testid="demo-tour-skip" onClick={() => update({ finished: true, skipped: true })}>{t("demo.tour.skip")}</Button>
            )}
            {here ? (
              <button type="button" data-testid="demo-tour-next" className="band-colour h-9 px-3 text-sm font-semibold" onClick={() => (last ? update({ finished: true }) : go(state.step + 1))}>
                {t("demo.tour.next")} →
              </button>
            ) : (
              <button type="button" data-testid="demo-tour-back" className="band-colour h-9 px-3 text-sm font-semibold" onClick={() => go(state.step)}>
                {t("demo.tour.look_here", { target: t(`demo.tour.target.${step.target}`) })} →
              </button>
            )}
          </div>
        </aside>
      );
    }
  }

  // The administrator has no tour, and lands on the densest page there is: the 总簿 now (`defaultView.ts`), or the
  // dashboard it used to be, which the sidebar still opens.
  if (!card && username === DEMO_USERNAMES.admin && (pathname === "/desk/overview" || pathname === "/dashboard") && !state.closed) {
    card = (
      <aside ref={panelRef} data-testid="demo-admin-hint" className={panel}>
        <p className="m-0 text-sm text-[oklch(var(--color-ink))]">{t("demo.admin_hint")}</p>
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => update({ closed: true })}>{t("common.close")}</Button>
        </div>
      </aside>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      <EntranceOverlay />
      {card}
    </>
  );
}
