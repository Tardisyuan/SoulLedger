"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FocusEvent } from "react";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { JourneyBlock } from "@/src/components/souls/detail/SoulLedgerProgress";
import { useI18n } from "@/src/contexts/I18nContext";
import extract from "./data/home-preview.json";
import { PREVIEW_ORDER, TURN_MS, nextCiv, previewMode, previewOf, type PreviewExtract } from "./homePreview";
import { langOf } from "./store";

const REDUCED = "(prefers-reduced-motion: reduce)";
const NARROW = "(max-width: 47.99rem)";

/** A media query, live. Before hydration (and with no `matchMedia`): false. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", on);
      return () => list.removeEventListener("change", on);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * 「预览 · 一个灵魂的行程」(Design 第二十七批 §一.2 / §二): the soul page's journey block, fed from the
 * recordings' extract (`data/home-preview.json`, a few KB; the recordings themselves load only on the way in).
 * Wide: the four underworlds in turn — the walked road draws on, holds, and the next fades in; hovering or focusing
 * pauses it (the tab's countdown bar is the clock: its `animationend` turns the page). Reduced motion: 地府 stays and
 * the tabs are plain buttons. Narrow: a still frame of 地府; a tap plays the draw-on once, in place.
 */
export function HomePreview({ onShown }: { onShown?: (skin: SealCiv) => void }) {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const mode = previewMode({ reduced: useMedia(REDUCED), narrow: useMedia(NARROW) });
  const [picked, setPicked] = useState<SealCiv>("cn");
  const [paused, setPaused] = useState(false);
  const [plays, setPlays] = useState(0);
  const skin = mode === "still" ? "cn" : picked;
  const data = useMemo(() => previewOf(extract as unknown as PreviewExtract, skin, lang), [skin, lang]);

  useEffect(() => onShown?.(skin), [skin, onShown]);
  const still = mode === "still" && plays === 0;
  const blur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
  };
  const name = data ? String(data.soul.name ?? "") : "";

  return (
    <section
      aria-labelledby="demo-preview-title"
      data-testid="demo-home-preview"
      data-mode={mode}
      data-shown={skin}
      className="min-w-0"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={blur}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="demo-preview-title" className="m-0 text-sm font-semibold text-[oklch(var(--color-ink))]">
          {t("demo.home.preview_title")}
        </h2>
        <span className="text-xs text-[oklch(var(--color-ink-subtle))]">
          {t(mode === "cycle" ? "demo.home.preview_sub" : mode === "manual" ? "demo.home.preview_manual" : "demo.home.preview_static")}
        </span>
      </div>

      <div className="demo-preview-card relative mt-3 min-w-0 p-4" data-still={still ? "" : undefined}>
        <div key={`${skin}-${plays}`} data-civ={skin} className="demo-preview-frame min-w-0">
          <p className="m-0 mb-2 flex min-w-0 items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))]">
            <Seal size={14} civ={skin} glyphs={null} decorative />
            <span className="truncate" title={name}>
              {data ? t("demo.home.preview_soul", { name }) : t(`demo.civ.${skin}.name`)}
            </span>
          </p>
          {data ? (
            <JourneyBlock
              soul={data.soul}
              judgments={data.judgments}
              dispositions={data.dispositions}
              reincarnations={data.reincarnations}
              birthDisplay={null}
              deathDisplay={null}
              realms={data.realms}
              path={data.path}
              bare
            />
          ) : (
            <div className="demo-preview-wait" />
          )}
        </div>
        {mode === "still" && (
          <button
            type="button"
            data-testid="demo-home-preview-play"
            aria-label={t("demo.home.preview_static")}
            onClick={() => setPlays((n) => n + 1)}
            className="demo-preview-play absolute inset-0"
          />
        )}
      </div>

      {mode !== "still" && (
        <div role="group" aria-label={t("demo.home.preview_tabs")} className="mt-3 flex flex-wrap items-center gap-4">
          {PREVIEW_ORDER.map((civ) => (
            <button
              key={civ}
              type="button"
              data-civ={civ}
              aria-pressed={civ === skin}
              onClick={() => setPicked(civ)}
              className="demo-preview-tab flex h-8 items-center gap-2 text-xs"
            >
              <Seal size={14} civ={civ} glyphs={null} decorative />
              <span>{t(`demo.civ.${civ}.name`)}</span>
              {mode === "cycle" && civ === skin && (
                <span aria-hidden="true" className="demo-preview-countdown">
                  <span
                    className="demo-preview-countdown-fill"
                    data-paused={paused ? "" : undefined}
                    style={{ animationDuration: `${TURN_MS}ms` }}
                    onAnimationEnd={(e) => {
                      // Reduced motion collapses every animation to 1 ms (globals.css): that end is not a turn.
                      if (e.animationName === "demo-home-countdown" && !window.matchMedia?.(REDUCED).matches) setPicked(nextCiv(civ));
                    }}
                  />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
