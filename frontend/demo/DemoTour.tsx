"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@soulledger/core/api/client";
import { Button } from "@/src/components/ui/Button";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import stats from "@/src/config/landing-stats.json";
import { ENTRANCE, ROLE_OF_SKIN, SKINS, TOUR_KEY, useEnter } from "./DemoEntrances";
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

/** The seal (Design batches 70, 71): colour spreads from the card, the seal lands, and the colour narrows to the identity
 *  band over the page, which by then is underneath; the real band takes over as it goes. At most 700 ms. */
const STYLES = `.demo-tour-target{outline:2px solid oklch(var(--color-main));outline-offset:4px;box-shadow:0 0 0 8px color-mix(in srgb,oklch(var(--color-main)) 16%,transparent);scroll-margin-top:9.5rem}
body:has([data-testid='demo-tour']:not([data-finished])) main{padding-bottom:max(45vh,22rem)}
@keyframes demo-seal-spread{from{clip-path:circle(0 at var(--x) var(--y))}to{clip-path:circle(150vmax at var(--x) var(--y))}}
@keyframes demo-seal-drop{0%{opacity:0;transform:translate(-50%,-50%) scale(1.15)}85%{opacity:1;transform:translate(-50%,-50%) scale(.98)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes demo-seal-narrow{to{top:var(--band-top);left:var(--band-left);height:var(--band-height)}}
@keyframes demo-seal-to-slot{to{left:calc(var(--band-height)/2 + 8px);transform:translate(-50%,-50%) scale(.5)}}
@keyframes demo-seal-name-out{to{opacity:0}}
@keyframes demo-seal-fade{from{opacity:1}to{opacity:0}}
.demo-seal{--band-top:calc(1.75rem + 52px);--band-left:0px;--band-height:48px;position:fixed;top:0;left:0;right:0;height:100vh;z-index:9999;overflow:hidden;animation:demo-seal-spread 200ms ease-out both,demo-seal-narrow 250ms ease-in-out 450ms forwards}
@media (min-width:769px){.demo-seal{--band-left:252px;--band-height:64px}}
.demo-seal-mark,.demo-seal-name{position:absolute;left:50%;transform:translate(-50%,-50%)}
.demo-seal-mark{top:50%;animation:demo-seal-drop 250ms ease-out 200ms both,demo-seal-to-slot 250ms ease-in-out 450ms forwards}
.demo-seal-name{top:calc(50% + 72px);animation:demo-seal-name-out 150ms ease-in 450ms forwards}
.demo-seal-skip{position:absolute;top:8px;right:8px;animation:demo-seal-name-out 100ms ease-in 450ms forwards}
@media (prefers-reduced-motion:reduce){.demo-seal{background:oklch(var(--color-canvas));animation:demo-seal-fade 150ms ease-out both}.demo-seal>*{display:none}}`;

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

/** Centred if the card leaves it clear, otherwise at the top: the page has room to spare below it while the card is up (STYLES). */
function reveal(target: Element): void {
  target.scrollIntoView({ block: "center", behavior: "auto" });
  const card = document.querySelector("[data-testid='demo-tour']")?.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  if (card && box.bottom > card.top && box.top < card.bottom && box.right > card.left && box.left < card.right) {
    target.scrollIntoView({ block: "start", behavior: "auto" });
  }
}

/** The seal on the way in from a card: at most 700 ms, over the page, which does not wait for it. */
function EntranceOverlay() {
  const { t } = useI18n();
  const [run, setRun] = useState<{ skin: SealCiv; x: number; y: number } | null>(null);

  useEffect(() => {
    const start = (e: Event) => {
      const { skin, origin } = (e as CustomEvent).detail as { skin: SealCiv; origin: { x: number; y: number } };
      setRun({ skin, x: origin.x, y: origin.y });
    };
    window.addEventListener(ENTRANCE, start);
    return () => window.removeEventListener(ENTRANCE, start);
  }, []);

  useEffect(() => {
    if (!run) return;
    const end = () => setRun(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    const timer = setTimeout(end, 700);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [run]);

  if (!run) return null;
  const name = t(`demo.civ.${run.skin}.name`);
  return (
    // A click anywhere skips it; Esc does the same, on the window, and the 跳过 button is the keyboard's way.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-testid="demo-entrance"
      data-civ={run.skin}
      onClick={() => setRun(null)}
      className="seal-on-band band-colour demo-seal"
      style={{ "--x": `${run.x}px`, "--y": `${run.y}px` } as React.CSSProperties}
    >
      <span aria-live="polite" className="sr-only">{t("demo.enter.entering", { civ: name })}</span>
      <span className="demo-seal-mark"><Seal size={96} civ={run.skin} glyphs={null} court={name} /></span>
      <span className="demo-seal-name whitespace-nowrap font-title text-lg">{name}</span>
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
  const { enter } = useEnter();
  const pathname = usePathname();
  const router = useRouter();
  const [tour, setTour] = useState<Tour | null>(null);
  const [state, setState] = useState<State>(START);
  const [lift, setLift] = useState(0);
  const username = user?.username ?? null;

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
  }, [username]);

  const step = tour?.steps[state.step];
  const here = !!step && pathname === step.route;
  const showing = !state.collapsed && !state.finished && !state.closed;

  useEffect(() => {
    if (!here || !showing) return;
    let tries = 0;
    let lit: Element | null = null;
    let again: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      if (step?.tab) {
        const label = t(step.tab);
        const tab = Array.from(document.querySelectorAll<HTMLElement>("[role='tab']")).find((el) => onScreen(el) && el.textContent?.includes(label));
        if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      }
      const found = findTarget(step?.css, step?.text, step?.up);
      tries += 1;
      if (found) {
        lit = found;
        found.classList.add("demo-tour-target");
        reveal(found);
        // Once more when the card has settled above the verdict bar (`lift`, measured every 300 ms).
        again = setTimeout(() => reveal(found), 350);
      }
      if (lit || tries > 25) clearInterval(timer);
    }, 120);
    return () => {
      clearInterval(timer);
      clearTimeout(again);
      lit?.classList.remove("demo-tour-target");
    };
  }, [here, step, showing, t]);

  // The verdict keys are what the page is for: the card sits above the bar that holds them.
  useEffect(() => {
    if (!showing) {
      setLift(0);
      return;
    }
    const measure = () => {
      const bar = document.querySelector("[class*='bottom-(--bottom-bar)'], [data-testid='verdict-bar']");
      const box = bar?.getBoundingClientRect();
      setLift(box && box.top < window.innerHeight && box.bottom > window.innerHeight * 0.5 ? window.innerHeight - box.top + 12 : 0);
    };
    measure();
    const timer = setInterval(measure, 300);
    return () => clearInterval(timer);
  }, [showing, pathname]);

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
    const civ = t(`demo.civ.${tour.skin}.name`);
    const total = tour.steps.length;
    if (state.finished) {
      card = (
        <aside data-testid="demo-tour" data-finished="" className={panel}>
          <p className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t(state.skipped ? "demo.tour.skipped_title" : "demo.tour.done_title")}</p>
          <p className="mt-1 mb-0 text-sm text-[oklch(var(--color-ink-muted))]">{state.skipped ? t("demo.tour.skipped_body") : t("demo.tour.done_body", { civ })}</p>
          <ul className="m-0 mt-3 flex list-none gap-2 p-0">
            {SKINS.filter((skin) => skin !== tour.skin).map((skin) => (
              <li key={skin} data-civ={skin}>
                <button
                  type="button"
                  data-testid={`demo-tour-other-${skin}`}
                  aria-label={t("demo.landing.card_label", { civ: t(`demo.civ.${skin}.name`) })}
                  onClick={() => void enter(ROLE_OF_SKIN[skin])}
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
        <aside data-testid="demo-tour" data-civ={tour.skin} className={panel} style={lift ? { bottom: lift } : undefined}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.tour.title_civ", { civ })}</span>
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

  // The administrator has no tour, and lands on the densest page there is.
  if (!card && username === DEMO_USERNAMES.admin && pathname === "/dashboard" && !state.closed) {
    card = (
      <aside data-testid="demo-admin-hint" className={panel}>
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
