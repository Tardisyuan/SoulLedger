"use client";

import Link from "next/link";
import { CIVILIZATION_OPTIONS, getCivilizationFromTenantCode } from "@soulledger/core/config/civilizations";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";
import { cn } from "@/lib/utils";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 落地页(Design A10,`docs/design-handoff/v3-pages/A10-landing.md`)。
 *
 * 公开页:`AppLayoutWrapper` 的 PUBLIC_PATHS 含 `/`,不经官员台外壳,所以顶行、高度都自己给。
 * 骨架与 A9 登录页相同 —— 顶行上 40、高 44,内容从 216 起,右栏 560 —— 两页切换时标与顶行不动。
 *
 * 字号按字级表落(Design 写的 88 / 24 / 22 不在档内):题字 display-lg 56(用户 2026-10-03 定)、
 * 副题 xl 28、文明名 lg 20。
 * 页面上没有文明色(不在 v3 的五处之内):四文明用墨色字形区分;「你的冥界」是 3px 墨线加字。
 * 1440 的左右 72 用 1296 宽的居中容器给,不用 px-18(节奏刻度里没有 18)。
 */
export default function HomePage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const mine = user?.tenant?.code ? getCivilizationFromTenantCode(user.tenant.code) : null;
  const name = user ? user.display_name || user.username : null;
  const signedIn = name ? t("home.signed_in_as", { name }) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-[oklch(var(--color-canvas))]">
      <div aria-hidden="true" className="hidden h-10 shrink-0 md:block" />
      <header className="mx-auto flex h-14 w-full max-w-[1296px] shrink-0 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] px-6 md:h-11 md:border-b-0 md:px-0">
        <div data-testid="landing-brand" className="flex min-w-0 items-center gap-3">
          <BrandMark size={24} className="md:hidden" />
          <BrandMark size={32} className="max-md:hidden" />
          <span className="font-title text-md text-[oklch(var(--color-ink))] md:text-lg">灵魂簿</span>
          <span className="truncate text-sm text-[oklch(var(--color-ink-muted))] max-md:hidden">SoulLedger</span>
        </div>
        <div className="flex items-center gap-3">
          {signedIn ? <span className="text-sm text-[oklch(var(--color-ink-muted))] max-md:hidden">{signedIn}</span> : null}
          <div className="flex items-center gap-2 max-md:hidden">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          {/* 导航,不是动作:描边链接,不用 primary 按钮。→ 不是 ↗:站内跳转,不是外链。 */}
          <Link
            href={user ? "/dashboard" : "/login"}
            data-testid="landing-console"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-control border border-[oklch(var(--color-ink))] px-4 text-sm font-medium text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
          >
            {t("home.console")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1296px] flex-1 px-6 md:px-0">
        <div aria-hidden="true" className="h-8 md:h-33" />
        <section className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_560px]">
          <div>
            <h1 className="m-0 font-title text-xl text-[oklch(var(--color-ink))] md:text-display-lg">{t("home.hero_title")}</h1>
            <p className="mt-3 font-title text-lg text-[oklch(var(--color-ink))] md:text-xl">{t("home.hero_subtitle")}</p>
            <p className="mt-4 max-w-[30em] text-md font-normal text-[oklch(var(--color-ink-muted))]">{t("home.hero_description")}</p>
            {signedIn ? <p className="mt-4 text-sm text-[oklch(var(--color-ink-muted))] md:hidden">{signedIn}</p> : null}
          </div>
          <div className="hidden justify-end md:flex">
            <BrandMark size={240} />
          </div>
        </section>

        <section aria-labelledby="landing-civs-title" className="mt-12 pb-12">
          <h2 id="landing-civs-title" className="m-0 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
            {t("home.civilizations_title")}
            <span className="text-[oklch(var(--color-ink-subtle))]"> · {t("home.civilizations_eyebrow_sub")}</span>
          </h2>
          <ul data-testid="landing-civs" className="m-0 mt-4 grid list-none grid-cols-1 p-0 md:grid-cols-4 md:gap-6">
            {CIVILIZATION_OPTIONS.map((civ) => {
              const own = civ === mine;
              return (
                <li
                  key={civ}
                  data-civ={civ}
                  data-mine={own || undefined}
                  className={cn(
                    "py-4 md:pt-3 md:pb-0",
                    own
                      ? "border-t-3 border-[oklch(var(--color-ink))]"
                      : "border-t border-[oklch(var(--color-line-strong))] md:border-[oklch(var(--color-ink))]"
                  )}
                >
                  <p className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">
                    <span aria-hidden="true">{CIVILIZATION_MARK[civ]} </span>
                    {t(`home.civilizations.${civ}`)}
                  </p>
                  <p className="m-0 mt-1 text-xs text-[oklch(var(--color-ink-muted))] md:text-sm">{t(`home.civ_subtitle.${civ}`)}</p>
                  <p className="m-0 mt-2 text-sm text-[oklch(var(--color-ink))] md:text-md md:font-normal">{t(`home.civ_desc.${civ}`)}</p>
                  {own ? (
                    <p className="m-0 mt-3 text-xs font-semibold text-[oklch(var(--color-ink))]">
                      <span aria-hidden="true">◉ </span>
                      {t("home.your_realm")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      {/* 393:语言与明暗放不进顶栏,挪到页脚上方一行。 */}
      <div className="flex items-center justify-between gap-3 bg-[oklch(var(--color-surface-1))] px-6 py-3 md:hidden">
        <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t("welcome.prefs")}</span>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <footer className="shrink-0 border-t border-[oklch(var(--color-line))] max-md:bg-[oklch(var(--color-surface-1))]">
        <div className="mx-auto flex h-16 w-full max-w-[1296px] items-center justify-between gap-3 px-6 md:px-0">
          <Motto />
          <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{t("footer.version")}</span>
        </div>
      </footer>
    </div>
  );
}

/** 页脚题词。每种语言一句，不是同一句的译文;埃及语界面写圣书体。 */
function Motto() {
  const { locale } = useI18n();
  if (locale === "egy") {
    return (
      <span className="text-sm text-[oklch(var(--color-ink))]" style={{ fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }}>
        𓇳 𓋹 𓎛 𓃭
      </span>
    );
  }
  return (
    <span className="font-serif text-md font-medium text-[oklch(var(--color-ink))]">
      {locale === "en" ? "Every soul weighed, every life recorded" : "万古轮回皆有录"}
    </span>
  );
}
