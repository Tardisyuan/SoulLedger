"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@soulledger/core/api/client";
import { Button } from "@/src/components/ui/Button";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { ENTRANCE, ROLE_OF_SKIN, SKINS, TOUR_KEY, useEnter } from "./DemoEntrances";
import type { Tour } from "./tour";

/** Where the visitor is in the tour. In the tab, so a refresh keeps it and a new tab starts fresh, like the rest of the demo. */
type State = { step: number; collapsed: boolean; finished: boolean; closed: boolean };
const START: State = { step: 0, collapsed: false, finished: false, closed: false };

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

const STYLES = `.demo-tour-target{outline:2px solid oklch(var(--color-main));outline-offset:4px;box-shadow:0 0 0 8px color-mix(in srgb,oklch(var(--color-main)) 16%,transparent)}
@keyframes demo-seal-spread{from{clip-path:circle(0 at var(--x) var(--y))}to{clip-path:circle(150vmax at var(--x) var(--y))}}
@keyframes demo-seal-drop{0%{opacity:0;transform:scale(1.15)}85%{opacity:1;transform:scale(.98)}100%{opacity:1;transform:scale(1)}}
@keyframes demo-seal-leave{to{opacity:0}}
@keyframes demo-seal-fade{from{opacity:1}to{opacity:0}}
.demo-seal{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;animation:demo-seal-spread 200ms ease-out both,demo-seal-leave 250ms ease-in 450ms both}
.demo-seal-mark{animation:demo-seal-drop 250ms ease-out 200ms both}
@media (prefers-reduced-motion:reduce){.demo-seal{background:oklch(var(--color-canvas));animation:demo-seal-fade 150ms ease-out both}.demo-seal>*{display:none}}`;

function findTarget(css?: string, text?: string): Element | null {
  const byCss = css ? document.querySelector(css) : null;
  if (byCss || !text) return byCss;
  const main = document.querySelector("main");
  const rows = main ? Array.from(main.querySelectorAll("tr, li, article")) : [];
  return rows.find((row) => row.textContent?.includes(text)) ?? null;
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
      <span className="demo-seal-mark font-title text-lg">{name}</span>
      <button type="button" onClick={() => setRun(null)} className="absolute top-2 right-2 h-11 min-w-11 px-3 text-sm">
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
    const timer = setInterval(() => {
      if (step?.tab) {
        const label = t(step.tab);
        const tab = Array.from(document.querySelectorAll<HTMLElement>("[role='tab']")).find((el) => el.textContent?.includes(label));
        if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      }
      const found = findTarget(step?.css, step?.text);
      tries += 1;
      if (found && (found as HTMLElement).offsetParent !== null) {
        lit = found;
        found.classList.add("demo-tour-target");
        found.scrollIntoView({ block: "center", behavior: "auto" });
      }
      if (lit || tries > 25) clearInterval(timer);
    }, 120);
    return () => {
      clearInterval(timer);
      lit?.classList.remove("demo-tour-target");
    };
  }, [here, step, showing, t]);

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
          <p className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t("demo.tour.done_title")}</p>
          <p className="mt-1 mb-0 text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.tour.done_body", { civ })}</p>
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
        <aside data-testid="demo-tour" data-civ={tour.skin} className={panel}>
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
              <Button type="button" variant="ghost" size="sm" data-testid="demo-tour-skip" onClick={() => update({ finished: true })}>{t("demo.tour.skip")}</Button>
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

  return (
    <>
      <style>{STYLES}</style>
      <EntranceOverlay />
      {card}
    </>
  );
}
