"use client";

/**
 * 演示站的灵魂入口(v4 第十批第 1 条)。只在演示版有:正式网页只给官员和管理员用,灵魂只在 App 里。
 *
 * - 落地页:四张卡片正下方一条带子(`DemoSoulEntry`),四个「以灵魂身份看看」与上面的卡片同列。
 * - 进去之后,≥ 1024 宽:左边说明栏,右边 393 × 852 原大的手机框;更窄:不套框，铺满，顶上一条 40 高的深色演示条。
 * - 「回到判官视角」回到同一个冥界的判官概览，也就是演示账号的判官身份(`useEnter`)。
 * - 胶囊标签栏照 App:不透明，贴在页底。锁屏的实时进度是演示里多出来的一屏，标「只在演示里」。
 */
import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { Seal, type SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { ROLE_OF_SKIN, SKINS, useEnter } from "./DemoEntrances";
import { REBIRTH_CIVS, SoulScreenBody, Unrecorded, soulView, type SoulScreen, type SoulView } from "./DemoSoulScreens";
import { langOf, soulRecording, soulRecordingNow } from "./store";

const TABS: Record<Exclude<SoulScreen, "lock">, string> = {
  life: "soul_app.tabs.life",
  letters: "soul_app.chat.tab",
  circle: "soul_app.circle.tab",
  rebirth: "soul_app.tabs.rebirth",
};
const tabsOf = (civ: SealCiv) => (Object.keys(TABS) as (keyof typeof TABS)[]).filter((s) => s !== "rebirth" || REBIRTH_CIVS.has(civ));

/** The band under the four cards. The cards keep their one action; this is the second way in. */
export function DemoSoulEntry({ onLook }: { onLook: (civ: SealCiv) => void }) {
  const { t, locale } = useI18n();
  return (
    <section data-testid="demo-soul-entry" aria-labelledby="demo-soul-entry-title" className="mt-4 rounded-panel border border-[oklch(var(--color-line))] p-4">
      <h3 id="demo-soul-entry-title" className="m-0 font-title text-md text-[oklch(var(--color-ink))]">{t("demo.soul.entry_title")}</h3>
      <p className="m-0 mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.soul.entry_body")}</p>
      <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-4 p-0 xl:grid-cols-4">
        {SKINS.map((civ) => (
          <li key={civ} data-civ={civ}>
            <button
              type="button"
              data-testid={`demo-soul-${civ}`}
              onClick={() => onLook(civ)}
              onPointerEnter={() => void soulRecording(civ, langOf(locale))}
              onFocus={() => void soulRecording(civ, langOf(locale))}
              aria-label={`${t("demo.soul.entry_button")} · ${t(`demo.civ.${civ}.name`)}`}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-control border border-[oklch(var(--color-line-strong))] px-3 text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-1))] focus-visible:outline-2 focus-visible:outline-[oklch(var(--color-focus))]"
            >
              <span className="max-md:hidden">{t("demo.soul.entry_button")} ·</span>
              <span>{t(`demo.civ.${civ}.name`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Read in the render itself when it has already loaded (it usually has: `DemoHome` waits for it), so the phone's first
 *  frame is not an empty screen. */
function useSoulView(civ: SealCiv): SoulView | null | undefined {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const rec = soulRecordingNow(civ, lang);
  const [, loaded] = useState(0);
  useEffect(() => {
    let live = true;
    void soulRecording(civ, lang).then(() => live && loaded((n) => n + 1));
    return () => {
      live = false;
    };
  }, [civ, lang]);
  return useMemo(() => (rec === undefined ? undefined : rec && soulView(rec, civ, t)), [rec, civ, t]);
}

export default function DemoSoul({ civ, onCiv }: { civ: SealCiv; onCiv: (civ: SealCiv) => void }) {
  const { t } = useI18n();
  const { entering, enter } = useEnter();
  const view = useSoulView(civ);
  const [screen, setScreen] = useState<SoulScreen>("life");
  const shown = screen === "rebirth" && !REBIRTH_CIVS.has(civ) ? "life" : screen;
  const back = () => void enter(ROLE_OF_SKIN[civ]);
  const app = (
    <div data-civ={civ} className="flex h-full flex-col bg-[oklch(var(--color-canvas))] text-[oklch(var(--color-ink))]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === undefined ? null : view === null ? <Unrecorded /> : <SoulScreenBody screen={shown} view={view} civ={civ} />}
      </div>
      {shown !== "lock" && <CapsuleTabs civ={civ} screen={shown} onScreen={setScreen} />}
    </div>
  );
  return (
    <div data-testid="demo-soul" data-civ={civ} className="min-h-dvh bg-[oklch(var(--color-canvas))]">
      {/* Narrower than 1024: no frame (it would shrink too far); the strip sits where the app's status bar would. */}
      {/* Under the demo banner (`--imp-h`, DemoBanner), so the app's own scroll ends at the foot of the screen. */}
      <div className="flex h-[calc(100dvh-var(--imp-h,0px))] flex-col lg:hidden">
        <div data-testid="demo-soul-strip" className="flex h-10 shrink-0 items-center justify-between gap-3 bg-[oklch(var(--color-ink))] px-4 text-xs text-[oklch(var(--color-canvas))]">
          <span className="truncate">{t("demo.soul.strip")}</span>
          <span className="flex items-center gap-4">
            <button type="button" onClick={() => setScreen(shown === "lock" ? "life" : "lock")} className="underline-offset-2 hover:underline">
              {t("demo.soul.lock")}
            </button>
            <button type="button" data-testid="demo-soul-back-short" disabled={entering !== null} onClick={back} className="underline-offset-2 hover:underline">
              {t("demo.soul.back_short")}
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1">{app}</div>
      </div>
      <div className="mx-auto hidden max-w-6xl gap-10 px-8 py-8 lg:flex">
        <aside className="flex w-80 shrink-0 flex-col gap-6">
          <div className="flex items-center gap-3">
            <BrandMark size={28} />
            <span className="font-title text-md">灵魂簿</span>
            <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.soul.badge")}</span>
          </div>
          <div>
            <p className="m-0 font-title text-lg">{view?.me?.name ?? t(`demo.civ.${civ}.name`)}</p>
            <p className="m-0 mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{[view?.life, t(`plaque.realm.${civ}`)].filter(Boolean).join(" · ")}</p>
          </div>
          <p data-testid="demo-soul-note" className="m-0 text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.soul.note")}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("demo.soul.badge")}>
            {[...tabsOf(civ), "lock" as const].map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={shown === s}
                  onClick={() => setScreen(s)}
                  className={`flex w-full items-baseline justify-between rounded-control px-3 py-2 text-left text-sm ${shown === s ? "bg-[oklch(var(--color-surface-2))] font-semibold" : "hover:bg-[oklch(var(--color-surface-1))]"}`}
                >
                  <span>{t(s === "lock" ? "demo.soul.lock" : TABS[s])}</span>
                  {s === "lock" && <span className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("demo.soul.lock_hint")}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div>
            <p className="m-0 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("demo.soul.switch_civ")}</p>
            <div className="mt-2 flex gap-3">
              {SKINS.map((c) => (
                <button key={c} type="button" aria-pressed={c === civ} aria-label={t(`demo.civ.${c}.name`)} onClick={() => onCiv(c)} className={c === civ ? "" : "opacity-60 hover:opacity-100"}>
                  <Seal size={36} civ={c} glyphs={null} court={t(`demo.civ.${c}.name`)} decorative />
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            data-testid="demo-soul-back"
            disabled={entering !== null}
            onClick={back}
            className="h-11 rounded-control border border-[oklch(var(--color-ink))] px-4 text-sm font-medium"
          >
            {t("demo.soul.back")} →
          </button>
        </aside>
        {/* 393 × 852, the app's own size, not scaled. */}
        <div data-testid="demo-soul-phone" className="h-[852px] w-[393px] shrink-0 overflow-hidden rounded-[44px] border-8 border-[oklch(var(--color-ink))] shadow-overlay">
          {app}
        </div>
      </div>
    </div>
  );
}

/** v4's capsule tab bar as the app has it now: opaque, at the foot of the page. */
function CapsuleTabs({ civ, screen, onScreen }: { civ: SealCiv; screen: SoulScreen; onScreen: (s: SoulScreen) => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("demo.soul.strip")} className="shrink-0 px-4 pb-4 pt-2">
      <ul className="m-0 flex list-none justify-between gap-1 rounded-full border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-1">
        {tabsOf(civ).map((s) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              aria-current={screen === s ? "page" : undefined}
              onClick={() => onScreen(s)}
              className={`h-10 w-full rounded-full text-xs ${screen === s ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]" : "text-[oklch(var(--color-ink-muted))]"}`}
            >
              {t(TABS[s])}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
