"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CARD_SKIN, LandingHeader, LandingTitle, useCardTilt } from "@/src/components/landing/Landing";
import { LandingEmblem } from "@/src/components/landing/LandingEmblem";
import { SoulFire } from "@/src/components/landing/SoulFire";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { CIVILIZATION_SHAPE } from "@/src/lib/routeTopology";
import stats from "@/src/config/landing-stats.json";
import { ROLE_OF_SKIN, SKINS, useEnter } from "./DemoEntrances";
import DemoSoul from "./DemoSoul";
import { HomePeek } from "./HomePeek";
import { HomePreview } from "./HomePreview";
import { RouteShape } from "./RouteShape";
import { langOf, soulRecording } from "./store";

/**
 * The demo's home page (Design 第二十七批): a guided start instead of the product's landing page, which the real build
 * keeps as it is (`Landing.tsx`). From the top: the title, three steps and one primary button (地府第五殿's judge); the
 * moving journey preview; the four underworld cards (each signs in as its judge, behind the seal); the four roles in
 * one row; the GitHub footer. 「先看 30 秒」 is an overlay, mounted only while open.
 *
 * The soul's view is this page in another state, not a route: the demo adds no route a normal build could reach.
 */
export default function DemoHome() {
  const { t, locale } = useI18n();
  const { entering, enter, warm } = useEnter();
  const [soul, setSoul] = useState<SealCiv | null>(null);
  const [peek, setPeek] = useState(false);
  const [glow, setGlow] = useState<SealCiv>("cn");
  const onShown = useCallback((skin: SealCiv) => setGlow(skin), []);
  // The phone opens with its screen already drawn: the recording first (a few KB, usually fetched on hover), then the view.
  const look = (civ: SealCiv, top: boolean) =>
    void soulRecording(civ, langOf(locale)).then(() => {
      setSoul(civ);
      if (top) window.scrollTo(0, 0);
    });
  if (soul) return <DemoSoul civ={soul} onCiv={(civ) => look(civ, false)} />;
  const start = (from: HTMLElement) => void enter(ROLE_OF_SKIN.cn, from);

  return (
    <div className="demo-home flex min-h-dvh flex-col bg-[oklch(var(--color-canvas))]">
      <LandingHeader>
        <span className="max-md:hidden">
          <LanguageSwitcher />
        </span>
        <ThemeToggle />
        <a href={stats.github} target="_blank" rel="noreferrer" className="text-sm text-[oklch(var(--color-ink-muted))] underline-offset-2 hover:underline max-md:hidden">
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </LandingHeader>

      <main className="flex-1 landing-gutter">
        <section className="demo-home-hero relative isolate grid grid-cols-1 gap-8 pt-8 pb-8 lg:grid-cols-[minmax(0,500fr)_minmax(0,600fr)] lg:gap-12 lg:pt-12">
          <div aria-hidden="true" data-civ={glow} className="demo-home-glow" />
          <div className="min-w-0">
            <p className="demo-home-eyebrow m-0 mb-3 text-xs font-semibold">{t("demo.home.eyebrow")}</p>
            <LandingTitle />
            <p className="m-0 mt-4 max-w-[500px] text-md font-normal text-[oklch(var(--color-ink-muted))]">{t("demo.home.lede")}</p>
            <h2 className="m-0 mt-8 text-sm font-normal text-[oklch(var(--color-ink-subtle))]">{t("demo.home.route_title")}</h2>
            <ol data-testid="demo-home-steps" className="demo-home-steps m-0 mt-3 list-none p-0">
              {([1, 2, 3] as const).map((n) => (
                <li key={n} className="relative flex gap-3 pb-4">
                  <span aria-hidden="true" className="demo-home-step-num shrink-0" data-first={n === 1 ? "" : undefined}>
                    {n}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-md font-normal text-[oklch(var(--color-ink))]">{t(`demo.home.step${n}`)}</span>
                    <span className="block text-sm text-[oklch(var(--color-ink-muted))]">{t(`demo.home.step${n}_sub`)}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-4 max-md:flex-col max-md:items-stretch">
              <button
                type="button"
                data-testid="demo-home-start"
                disabled={entering !== null}
                onClick={(e: MouseEvent<HTMLButtonElement>) => start(e.currentTarget)}
                onPointerEnter={() => warm(ROLE_OF_SKIN.cn)}
                onFocus={() => warm(ROLE_OF_SKIN.cn)}
                className="demo-home-cta inline-flex min-h-12 items-center justify-center gap-2 px-6 text-md disabled:opacity-60"
              >
                <span>{t("demo.home.cta")}</span>
                <span className="demo-home-cta-sub text-sm font-normal">· {t("demo.home.cta_sub", { hall: t("demo.home.cta_hall") })}</span>
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" data-testid="demo-home-peek-open" onClick={() => setPeek(true)} className="demo-home-peek-link self-center text-sm">
                <span aria-hidden="true">▸ </span>
                {t("demo.home.peek")}
              </button>
            </div>
          </div>
          <HomePreview onShown={onShown} />
        </section>

        <CivCards enter={(skin, card) => void enter(ROLE_OF_SKIN[skin], card)} warm={(skin) => warm(ROLE_OF_SKIN[skin])} />
        <Roles onLook={(civ) => look(civ, true)} entering={entering !== null} enter={(role, el) => void enter(role, el)} />
      </main>

      <footer className="shrink-0 border-t border-[oklch(var(--color-line))]">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 landing-gutter py-3 text-xs text-[oklch(var(--color-ink-subtle))]">
          <span>{t("demo.home.footer")}</span>
          <span className="md:hidden">
            <LanguageSwitcher />
          </span>
          <span className="flex items-center gap-4">
            {/* The credits (fonts and other licences) stay one click away; no personal name or address (用户 2026-11-08). */}
            <a href="/about" className="underline-offset-2 hover:underline">{t("about.title")}</a>
            <a data-testid="demo-home-repo" href={stats.github} target="_blank" rel="noreferrer" className="text-[oklch(var(--color-ink))] underline-offset-2 hover:underline">
              GitHub <span aria-hidden="true">↗</span>
            </a>
          </span>
        </div>
      </footer>

      {/* Closed, the dialog renders nothing (Base UI mounts the popup only while open); kept here so focus goes back to the link. */}
      <HomePeek
        open={peek}
        onClose={() => setPeek(false)}
        onStart={(from) => {
          setPeek(false);
          start(from);
        }}
      />
    </div>
  );
}

/** 「四种冥界，四种走法」: the landing page's card (emblem, soul fire, tilt), with what each underworld's road is like. */
function CivCards({ enter, warm }: { enter: (skin: SealCiv, card: HTMLElement) => void; warm: (skin: SealCiv) => void }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="demo-home-civs" className="pt-4 pb-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="demo-home-civs" className="m-0 font-title text-xl text-[oklch(var(--color-ink))]">{t("demo.home.civ_title")}</h2>
        <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.home.civ_sub")}</span>
      </div>
      <ul data-testid="landing-civs" className="m-0 mt-4 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
        {CIVILIZATION_OPTIONS.map((civ) => (
          <CivCard key={civ} skin={CARD_SKIN[civ]} civilization={civ} enter={enter} warm={warm} />
        ))}
      </ul>
    </section>
  );
}

function CivCard({ skin, civilization, enter, warm }: { skin: SealCiv; civilization: string; enter: (skin: SealCiv, card: HTMLElement) => void; warm: (skin: SealCiv) => void }) {
  const { t } = useI18n();
  const tilt = useCardTilt();
  const name = t(`demo.civ.${skin}.name`);
  return (
    <li data-civ={skin} className="h-full">
      <button
        type="button"
        data-testid={`landing-card-${skin}`}
        aria-label={t("demo.landing.card_label", { civ: name })}
        onClick={(e) => enter(skin, e.currentTarget)}
        {...tilt}
        onPointerEnter={(e) => {
          tilt.onPointerEnter(e);
          warm(skin);
        }}
        onFocus={(e) => {
          tilt.onFocus(e);
          warm(skin);
        }}
        className="landing-card demo-home-card relative flex h-full w-full items-center gap-4 overflow-hidden border border-[oklch(var(--color-line))] p-4 text-left transition-[transform,box-shadow] duration-fast hover:-translate-y-[3px] hover:shadow-overlay focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[oklch(var(--color-focus))] md:flex-col md:items-stretch md:p-6"
      >
        <SoulFire civ={skin} />
        <span className="landing-emblem-layer relative shrink-0 md:self-center">
          <LandingEmblem civ={skin} size={76} className="md:size-[190px]" />
        </span>
        <span className="relative flex min-w-0 flex-1 flex-col gap-2 md:mt-4">
          <span className="flex min-w-0 items-center gap-2">
            <Seal size={16} civ={skin} glyphs={null} decorative className="max-md:hidden" />
            <span className="truncate font-title text-lg" title={name}>{name}</span>
            <span className="demo-home-feat ml-auto shrink-0 text-xs font-semibold max-md:ml-0">{t(`demo.home.feat.${skin}`)}</span>
          </span>
          <RouteShape shape={CIVILIZATION_SHAPE[civilization]} className="max-md:hidden" />
          <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t(`demo.home.feat.${skin}_body`)}</span>
          <span className="demo-home-enter mt-auto flex min-h-9 items-center gap-2 text-sm md:px-3">
            <span className="text-[oklch(var(--color-ink))]">{t("demo.home.enter_officer")}</span>
            <span className="min-w-0 truncate text-[oklch(var(--color-ink-subtle))]" title={t(`demo.home.hall.${skin}`)}>· {t(`demo.home.hall.${skin}`)}</span>
            <span aria-hidden="true" className="ml-auto max-md:ml-0">→</span>
          </span>
        </span>
      </button>
    </li>
  );
}

const ROLES = ["officer", "soul", "admin", "inspector"] as const;

/** 「四种身份」in one row: the officer's way in is the cards above; the soul's view and the two consoles from here. */
function Roles({ onLook, entering, enter }: { onLook: (civ: SealCiv) => void; entering: boolean; enter: (role: "admin" | "moderator", el: HTMLElement) => void }) {
  const { t, locale } = useI18n();
  const link = "underline-offset-2 hover:underline text-[oklch(var(--color-ink))] disabled:opacity-60";
  const go = (role: (typeof ROLES)[number]) => {
    if (role === "officer") return <span className="text-[oklch(var(--color-ink))]">{t("demo.home.role.officer_go")}</span>;
    if (role === "soul")
      return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[oklch(var(--color-ink))]">{t("demo.home.role.soul_go")}</span>
          {SKINS.map((civ) => (
            <button
              key={civ}
              type="button"
              data-civ={civ}
              data-testid={`demo-soul-${civ}`}
              onClick={() => onLook(civ)}
              onPointerEnter={() => void soulRecording(civ, langOf(locale))}
              onFocus={() => void soulRecording(civ, langOf(locale))}
              aria-label={`${t("demo.soul.entry_button")} · ${t(`demo.civ.${civ}.name`)}`}
              className={`${link} inline-flex min-h-8 items-center gap-1`}
            >
              <Seal size={14} civ={civ} glyphs={null} decorative />
              {t(`demo.civ.${civ}.name`)}
            </button>
          ))}
        </span>
      );
    const as = role === "admin" ? "admin" : "moderator";
    return (
      <button type="button" data-testid={`demo-enter-${as}`} disabled={entering} title={t(`demo.role_${as}_desc`)} onClick={(e) => enter(as, e.currentTarget)} className={`${link} min-h-8`}>
        {t(`demo.home.role.${role}_go`)} <span aria-hidden="true">↗</span>
      </button>
    );
  };
  return (
    <section aria-labelledby="demo-home-roles" className="pb-12">
      <h2 id="demo-home-roles" className="m-0 text-sm font-normal text-[oklch(var(--color-ink-subtle))]">{t("demo.home.roles_title")}</h2>
      <ul className="demo-home-roles m-0 mt-3 grid list-none grid-cols-1 p-0 md:grid-cols-4">
        {ROLES.map((role) => (
          <li key={role} className="flex min-w-0 flex-col gap-1 p-4 max-md:px-0">
            <span className="text-md text-[oklch(var(--color-ink))]">{t(`demo.home.role.${role}`)}</span>
            <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t(`demo.home.role.${role}_body`)}</span>
            <span className="mt-1 text-sm">{go(role)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
