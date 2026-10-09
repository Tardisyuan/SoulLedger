"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/src/components/ui/Button";
import { formatSigil } from "@soulledger/core/config/civilizationSigil";
import { formatCitation } from "@soulledger/core/config/statuteCitation";
import { useI18n } from "@/src/contexts/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { CIVILIZATION_MARK, NUMBERING_SAMPLE } from "@/src/lib/civilizationIdentity";
import { LOGIN_STATUTES } from "@/src/lib/loginStatutes";
import { APP_VERSION } from "@/src/lib/appVersion";
import { cn } from "@/lib/utils";

/**
 * A9 的两栏骨架(左 canvas 律条与四文明,右 surface-1 表单),从 `app/(auth)/login/page.tsx` 搬出来,
 * 因为 A12 的登录第二步 `/login/verify` 用的是同一副骨架、只换右栏的表单。左栏逐字未动;
 * 为什么是这副样子,仍见登录页顶部那段注释。
 *
 * `narrowStatute=false`(第二步):393 下不放律条区,顶栏变成 ‹ + 标 24 + 灵魂簿 + ThemeToggle。
 */
const CIVS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"] as const;

/** 律条长度三档(A9 §二):按字数,不按测量 —— 60 以内大字一行到两行,160 以上折到 10 行、可展开。 */
export function statuteTier(text: string): "short" | "medium" | "long" {
  const n = Array.from(text).length;
  return n <= 60 ? "short" : n <= 160 ? "medium" : "long";
}

const TIER_CLASS = {
  // 36/56 与 28/46 不在八档字号里:36 取 display 40(登录页在 DISPLAY_ALLOW 里),行高照稿。
  short: "md:text-display md:leading-14 md:max-w-[22em]",
  medium: "md:text-xl md:leading-11.5",
  long: "md:text-lg md:leading-9 md:max-w-[34em]",
} as const;

/** 品牌行:天平标加「灵魂簿」与「SoulLedger · 官员台」。标对读屏隐藏 —— 旁边的字说了名字。 */
export function BrandRow({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div data-testid="login-brand" className="flex min-w-0 items-center gap-3">
      <BrandMark size={compact ? 24 : 32} />
      <span className={cn("font-title text-[oklch(var(--color-ink))]", compact ? "text-md" : "text-lg")}>灵魂簿</span>
      {compact ? null : <span title={t("auth.console")} className="truncate text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.console")}</span>}
    </div>
  );
}

/** 今日律条。按字数三档;长条折到 10 行、底部渐隐,393 一律先 4 行。「展开全文」只展开这一条。 */
export function Statute() {
  const { t } = useI18n();
  // Index 0 on the server and the first client render, then a random pick
  // after mount: a random index during render would hydrate against a
  // different quote than the server sent.
  const [statuteIndex, setStatuteIndex] = useState(0);
  useEffect(() => {
    setStatuteIndex(Math.floor(Math.random() * LOGIN_STATUTES.length));
  }, []);
  const statute = LOGIN_STATUTES[statuteIndex];
  const tier = statuteTier(statute.text);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [statuteIndex]);

  // 393 先 4 行(line-clamp):放不下才给「展开」。只在 clamp 生效时会量出溢出,宽屏上是 false。
  const quoteRef = useRef<HTMLQuoteElement>(null);
  const [clampedOnNarrow, setClampedOnNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = quoteRef.current;
    if (!el) return;
    const measure = () => setClampedOnNarrow(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [statute.text, expanded]);

  const folded = !expanded;
  const longFolded = tier === "long" && folded;
  const canExpand = folded && (tier === "long" || clampedOnNarrow);

  return (
    <section aria-label={t("auth.statute_eyebrow")} data-statute-tier={tier} className="flex flex-col gap-6">
      <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">
        {t("auth.statute_eyebrow")}
        <span> · {t("auth.statute_rotates")}</span>
      </p>
      <figure className="m-0 flex flex-col gap-4">
        <div className={cn("relative", longFolded && "md:max-h-90 md:overflow-hidden")}>
          <blockquote
            ref={quoteRef}
            data-testid="login-statute"
            title={folded ? statute.text : undefined}
            className={cn(
              "m-0 font-serif font-medium text-pretty text-[oklch(var(--color-ink))] text-lg leading-8.5",
              folded && "line-clamp-4 md:line-clamp-none",
              TIER_CLASS[tier]
            )}
          >
            {statute.text}
          </blockquote>
          {longFolded ? (
            <div
              aria-hidden="true"
              data-testid="login-statute-fade"
              className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-18 bg-linear-to-b from-transparent to-[oklch(var(--color-canvas))] md:block"
            />
          ) : null}
        </div>
        <figcaption className="flex flex-wrap items-center gap-3">
          <span aria-hidden="true" className="h-px w-6 bg-[oklch(var(--color-line-strong))]" />
          {/* 〔文献 · 条号〕—— 与语料页「复制引用」同一个括号(core/config/statuteCitation)。 */}
          <span data-testid="login-statute-cite" className="text-sm text-[oklch(var(--color-ink-muted))]">
            {formatCitation(
              t(`judgment.statute_corpus.${statute.corpus}`),
              formatSigil(statute.civilization, statute.ref) ?? statute.code
            )}
          </span>
          {canExpand ? (
            <span className={cn("flex items-center gap-3", tier !== "long" && "md:hidden")}>
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)}>
                {t("auth.statute_expand")}
                <span aria-hidden="true"> ↓</span>
              </Button>
              <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">
                {t("auth.statute_chars", { n: String(Array.from(statute.text).length) })}
              </span>
            </span>
          ) : null}
        </figcaption>
      </figure>
    </section>
  );
}

/** 四文明:字形(墨色)加文明名,下面是那个文明的编号法。宽屏底行四等分,393 是 56 高的列表。 */
export function CivNumbering() {
  const { t } = useI18n();
  return (
    <dl
      aria-label={t("auth.numbering")}
      data-testid="login-civs"
      className="m-0 grid grid-cols-1 border-t border-[oklch(var(--color-ink))] md:grid-cols-4"
    >
      {CIVS.map((civ) => (
        <div
          key={civ}
          className="flex min-h-14 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] md:flex-col md:items-start md:justify-start md:gap-1 md:border-b-0 md:border-r md:px-4 md:py-3 md:first:pl-0 md:last:border-r-0"
        >
          <dt className="text-xs text-[oklch(var(--color-ink-muted))]">
            <span aria-hidden="true" className="text-[oklch(var(--color-ink))]">{CIVILIZATION_MARK[civ]} </span>
            {t(`organization.civilizations.${civ}`)}
          </dt>
          <dd className="m-0 font-mono text-xs text-[oklch(var(--color-ink))]">{NUMBERING_SAMPLE[civ]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LoginShell({
  children,
  narrowStatute = true,
  back,
}: {
  children: React.ReactNode;
  /** 393 下左栏(律条与四文明)是否仍放在表单下方。登录第二步不放。 */
  narrowStatute?: boolean;
  /** 393 顶栏左侧的 ‹ 链接(第二步「换个账号登录」);宽屏上由表单自己画。 */
  back?: { href: string; label: string };
}) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh grid-cols-1 md:h-dvh md:grid-cols-[minmax(0,1fr)_560px]">
      {/* 左栏:律条与四文明。393 在表单下方(order-2),canvas 底加顶线,与表单那块分开。 */}
      <div
        className={cn(
          "order-2 min-h-0 flex-col border-t border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 md:order-1 md:flex md:border-t-0 md:border-r md:px-12",
          narrowStatute ? "flex" : "hidden"
        )}
      >
        <div aria-hidden="true" className="hidden h-10 shrink-0 md:block" />
        <div className="hidden h-11 shrink-0 items-center md:flex">
          <BrandRow />
        </div>
        <div aria-hidden="true" className="h-8 shrink-0 md:h-33" />
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          <Statute />
        </div>
        <div className="shrink-0 pb-8">
          <CivNumbering />
        </div>
      </div>

      {/* 右栏:表单。宽 400,左右各留 80(560 − 400)。
          md 起整页定高一屏(md:h-dvh),窗口矮于表单时右栏在自己里面滚 —— 与左栏律条区同一做法。
          此前没有 overflow,内容溢出栏外,栏底色停在视口底边,下面露出画布(用户 2026-10-03 截图)。 */}
      <div className="order-1 flex min-h-0 flex-col bg-[oklch(var(--color-surface-1))] px-4 md:order-2 md:overflow-y-auto md:px-0">
        <div aria-hidden="true" className="hidden h-10 shrink-0 md:block" />
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 md:mx-auto md:h-11 md:w-full md:max-w-[400px] md:justify-end">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            {back ? (
              <Link href={back.href} aria-label={back.label} className="flex size-11 shrink-0 items-center justify-center text-[oklch(var(--color-ink))]">
                <span aria-hidden="true">‹</span>
              </Link>
            ) : null}
            <BrandRow compact />
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <div aria-hidden="true" className="h-6 shrink-0 md:h-33" />
        <main className="mx-auto w-full max-w-[400px] flex-1 pb-8">{children}</main>
        <div className="mx-auto flex h-11 w-full max-w-[400px] shrink-0 items-center justify-between gap-3 pb-8 md:pb-0 md:mb-8">
          <Link href="/welcome" className="text-xs text-[oklch(var(--color-ink))] underline underline-offset-2">
            {t("auth.welcome_link")}
          </Link>
          <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}
