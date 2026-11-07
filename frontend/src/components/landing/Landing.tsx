"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { CivEmblem } from "@/src/components/brand/CivEmblem";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import stats from "@/src/config/landing-stats.json";

/** Which skin (`data-civ`, globals.css) each civilization wears. */
export const CARD_SKIN: Record<string, SealCiv> = { CHINESE: "cn", EUROPEAN: "eu", EGYPTIAN: "eg", GREEK: "gr" };

/**
 * Design batch 70: the page's subject is the four cards, and the first screen is all of it (1280 × 800).
 * v4(第七批落地页 · 阶段 5):题字与导语是 v4 的 `landing.title` / `landing.lede`,其余照旧复用 `demo.landing.*`;
 * 卡片是 v4 的卡(card 底上一层文明光,ink 字,金属角饰),印换成四个文明主视觉(`CivEmblem`),
 * 每张卡一句 `landing.civ.*`。
 */
export function Landing({
  kicker,
  onEnter,
  onWarm,
  secondary,
}: {
  /** A line above the title. Only the demo has something to say there. */
  kicker?: ReactNode;
  /** Sign in with one click. Without it (the real product) a card goes to `/login?civ=…`. */
  onEnter?: (skin: SealCiv, card: HTMLElement) => void;
  /** A pointer or the focus reached a card: start loading what its click will need. */
  onWarm?: (skin: SealCiv) => void;
  /** Ways in other than the four cards. */
  secondary?: ReactNode;
}) {
  const { t } = useI18n();
  const { user } = useTenant();
  return (
    <div className="flex min-h-dvh flex-col bg-[oklch(var(--color-canvas))]">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] landing-gutter">
        <div data-testid="landing-brand" className="flex min-w-0 items-center gap-3">
          <BrandMark size={28} />
          <span className="font-title text-md text-[oklch(var(--color-ink))]">灵魂簿</span>
          <span className="truncate text-sm text-[oklch(var(--color-ink-muted))] max-md:hidden">SoulLedger</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/#how-built" className="whitespace-nowrap text-sm text-[oklch(var(--color-ink-muted))] underline-offset-2 hover:underline">
            {t("demo.build.title")}
          </a>
          <span className="max-md:hidden"><LanguageSwitcher /></span>
          <ThemeToggle />
          {!onEnter && (
            <Link
              href={user ? "/dashboard" : "/login"}
              data-testid="landing-console"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-control border border-[oklch(var(--color-ink))] px-4 text-sm font-medium text-[oklch(var(--color-ink))]"
            >
              {t("home.console")}
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 landing-gutter">
        <section className="pt-8">
          {kicker && <p className="m-0 mb-3 font-mono text-xs text-[oklch(var(--color-ink-muted))]">{kicker}</p>}
          <h1 className="m-0 font-title text-xl text-[oklch(var(--color-ink))] md:text-display-lg">{t("landing.title")}</h1>
          <p className="mt-3 max-w-[44em] text-md text-[oklch(var(--color-ink-muted))]">{t("landing.lede")}</p>
        </section>

        <section className="mt-6" aria-labelledby="landing-pick">
          <h2 id="landing-pick" className="m-0 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("demo.landing.pick")}</h2>
          <ul data-testid="landing-civs" className="m-0 mt-3 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
            {CIVILIZATION_OPTIONS.map((civ) => (
              <CivCard key={civ} civ={civ} onEnter={onEnter} onWarm={onWarm} />
            ))}
          </ul>
          <ConsolePreview />
          {secondary}
        </section>

        <HowBuilt />
      </main>

      <footer className="shrink-0 border-t border-[oklch(var(--color-line))]">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 landing-gutter py-3">
          <span className="font-title text-sm text-[oklch(var(--color-ink))]">{t("demo.landing.footer")}</span>
          <span data-testid="landing-author" className="text-xs text-[oklch(var(--color-ink-muted))]">
            {t("demo.author.line", { name: stats.author.name })}{" "}
            <a href={stats.author.github} target="_blank" rel="noreferrer" className="underline underline-offset-2">GitHub</a>
          </span>
          <span className="md:hidden"><LanguageSwitcher /></span>
          <span className="flex flex-wrap items-center gap-4 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
            <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Built with Claude Code</a>
            <a href="/about" className="underline-offset-2 hover:underline">{t("about.title")}</a>
            <span>{t("footer.version")}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

function CivCard({
  civ,
  onEnter,
  onWarm,
}: {
  civ: string;
  onEnter?: (skin: SealCiv, card: HTMLElement) => void;
  onWarm?: (skin: SealCiv) => void;
}) {
  const { t } = useI18n();
  const skin = CARD_SKIN[civ];
  const name = t(`demo.civ.${skin}.name`);
  const body = (
    <>
      <span aria-hidden="true" className="v4-corner" />
      <span className="relative shrink-0 md:self-end">
        <CivEmblem civ={skin} size={88} className="md:size-30" />
      </span>
      <span className="relative flex min-w-0 flex-1 flex-col md:mt-4">
        <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{t(`demo.civ.${skin}.realm`)}</span>
        <span className="mt-1 font-title text-lg">{name}</span>
        <span className="mt-2 text-sm text-[oklch(var(--color-ink-muted))]">{t(`landing.civ.${skin}`)}</span>
        <span className="mt-auto pt-4 text-sm font-semibold text-[oklch(var(--color-main-ink))]">
          {t("demo.landing.enter_judge")} <span aria-hidden="true">→</span>
        </span>
      </span>
    </>
  );
  const look =
    "landing-card v4-card relative flex h-full min-h-37 w-full items-center gap-4 overflow-hidden rounded-panel border border-[oklch(var(--color-line))] p-4 text-left transition-[transform,box-shadow] duration-fast hover:-translate-y-[3px] hover:shadow-overlay focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[oklch(var(--color-focus))] md:min-h-80 md:flex-col md:items-stretch md:p-6";
  return (
    <li data-civ={skin} className="h-full">
      {onEnter ? (
        <button
          type="button"
          data-testid={`landing-card-${skin}`}
          aria-label={t("demo.landing.card_label", { civ: name })}
          onClick={(e) => onEnter(skin, e.currentTarget)}
          onPointerEnter={() => onWarm?.(skin)}
          onFocus={() => onWarm?.(skin)}
          className={look}
        >
          {body}
        </button>
      ) : (
        <Link
          href={`/login?civ=${skin}`}
          data-testid={`landing-card-${skin}`}
          aria-label={t("demo.landing.card_label", { civ: name })}
          className={look}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

/**
 * 「进去之后是这样」(v4 第八批落地页,`landing.preview_label`):卡片下面一张控制台缩略图,定稿只在手机宽度画(≥ md 时首屏
 * 本来就是四张卡,这一块不出现)。静态图,不是缩小渲染的组件 —— 不为落地页多拉一整套控制台的代码与数据。
 * 图是演示站的地府判官概览(1280 × 772,去掉演示横幅那一条,深浅各一张,`public/v4/console-preview-*.jpg`);按主题只显示一张,
 * `loading="lazy"` + `display: none` 的那张浏览器不取(globals.css 与 `.v4-emblem` 同一条规则)。
 * 演示站改版后要重截:截法写在提交信息里。
 */
function ConsolePreview() {
  const { t } = useI18n();
  return (
    <figure data-testid="landing-preview" className="m-0 mt-6 md:hidden">
      <figcaption className="mb-2 text-xs text-[oklch(var(--color-ink-muted))]">{t("landing.preview_label")}</figcaption>
      <div className="h-55 overflow-hidden rounded-panel border border-[oklch(var(--color-line))]">
        {(["light", "dark"] as const).map((theme) => (
          <img
            key={theme}
            src={`/v4/console-preview-${theme}.jpg`}
            data-theme={theme}
            alt=""
            width={1280}
            height={772}
            loading="lazy"
            decoding="async"
            className="v4-themed block h-full w-full object-cover object-left-top"
          />
        ))}
      </div>
    </figure>
  );
}

const TESTS = ["backend", "web", "soul_app", "officer_app", "e2e"] as const;

function HowBuilt() {
  const { t } = useI18n();
  const box = "border border-[oklch(var(--color-line-strong))] p-3 text-sm text-[oklch(var(--color-ink))]";
  return (
    <section id="how-built" className="mt-8 scroll-mt-20 border-t border-[oklch(var(--color-line-strong))] pt-8 pb-8" aria-labelledby="how-built-title">
      <h2 id="how-built-title" className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t("demo.build.title")}</h2>
      <p className="mt-2 max-w-[48em] text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.build.lede")}</p>
      <div data-testid="landing-architecture" className="mt-6 grid gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className={box}>{t("demo.build.node.web")} <span className="block font-mono text-xs text-[oklch(var(--color-ink-muted))]">Next.js</span></div>
          <div className={box}>{t("demo.build.node.soul_app")} <span className="block font-mono text-xs text-[oklch(var(--color-ink-muted))]">Expo</span></div>
          <div className={box}>{t("demo.build.node.officer_app")} <span className="block font-mono text-xs text-[oklch(var(--color-ink-muted))]">Expo</span></div>
        </div>
        <div className="border-2 border-[oklch(var(--color-ink))] p-3 text-sm text-[oklch(var(--color-ink))]">
          <span className="font-mono text-xs">packages/core</span> · {t("demo.build.node.core")}
          <span className="mt-1 block text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.build.node.core_detail")}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className={box}>{t("demo.build.node.backend")} <span className="block font-mono text-xs text-[oklch(var(--color-ink-muted))]">Django + Channels</span></div>
          <div className={box}>{t("demo.build.node.letters")} <span className="block font-mono text-xs text-[oklch(var(--color-ink-muted))]">Matrix</span></div>
        </div>
        <p className="m-0 border border-dashed border-[oklch(var(--color-line-strong))] p-3 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.build.node.tenancy")}</p>
      </div>
      <h3 className="mt-8 mb-0 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("demo.build.tests_title")}</h3>
      <dl data-testid="landing-numbers" className="m-0 mt-2 grid grid-cols-2 gap-4 md:grid-cols-5">
        {TESTS.map((key) => (
          <div key={key}>
            <dd className="m-0 font-title text-xl text-[oklch(var(--color-ink))]">{stats.tests[key]}</dd>
            <dt className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t(`demo.build.tests.${key}`)}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("demo.build.tests_caption", { date: stats.measured })}</p>
      <div className="mt-8 grid grid-cols-2 gap-4 md:max-w-xl">
        {stats.videos.map((video) => (
          <figure key={video.key} className="m-0">
            {/* Starts only when asked: no motion for those who turned it off, and no download for those who never look. */}
            <video src={video.src} poster={video.poster} controls muted loop playsInline preload="metadata" className="w-full border border-[oklch(var(--color-line-strong))]" />
            <figcaption className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t(`demo.build.${video.key}`)}</figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-6 text-sm">
        <a href={stats.github} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center border border-[oklch(var(--color-ink))] px-4 text-[oklch(var(--color-ink))]">
          {t("demo.build.github")} <span aria-hidden="true">&nbsp;↗</span>
        </a>
      </p>
    </section>
  );
}
