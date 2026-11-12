"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { ImpersonationBanner } from "@/src/components/impersonation/ImpersonationBanner";
import { HallViewExpired } from "@/src/components/impersonation/HallViewExpired";
import { useHallViewExpired } from "@/src/components/impersonation/hallViewExpiry";
import { MfaRequiredBanner } from "@/src/components/layout/MfaRequiredBanner";
import { PasswordChangeRedirect } from "@/src/components/layout/PasswordChangeRedirect";
import { BrandMark } from "@/src/components/brand/BrandMark";
import s from "./desk.module.css";

/**
 * 案卷台的壳(Design 第三十批 第 2 步):门栏 64 + 页面,铺满,不要全站的侧栏、工具条与题字行。
 * 只在 `/desk` 下(`AppLayoutWrapper` 的 `DESK_PATHS`);全站侧栏的改版是第 4 步。
 * 从 AppLayout 带过来的只有不能丢的几样:代看横条与过期、两步验证提示、改密码跳转、跳到正文。
 *
 * 门(用户决定):审 案卷 · 册 名册 · 律 律令 · 司 殿司(管理员)· 人 人间(版主,朋友圈审核)。
 * ≤ 768 门栏到底部,第四格换成「我」;殿司与人间在窄屏不放(殿司在窄屏只读,进「我」)。
 */
type Door = { href: string; glyph: string; label: string; match: (p: string) => boolean; wideOnly?: boolean };

/**
 * 门上的字:一个汉字是 18 的题字;拉丁字(en 的 L / R / M / C 是一个字母,egy 是 Wedja、Sesh 这样最多 6 个字母的词)
 * 多于一个字符时换成 12 的一行(`doorGlyphWord`),在 52 宽的门里不折行、不截断。导出给测试。
 */
export function doorGlyphClass(glyph: string): string {
  return Array.from(glyph).length > 1 ? `${s.doorGlyph} ${s.doorGlyphWord}` : s.doorGlyph;
}

export function DeskShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const expired = useHallViewExpired();

  const doors: Door[] = [
    { href: "/desk", glyph: t("caseDesk.rail.desk_glyph"), label: t("caseDesk.rail.desk"), match: (p) => p === "/desk" },
    ...(hasPermission("soul.read") ? [{ href: "/souls", glyph: t("caseDesk.rail.souls_glyph"), label: t("caseDesk.rail.souls"), match: () => false }] : []),
    ...(hasPermission("judgment.read") ? [{ href: "/corpus", glyph: t("caseDesk.rail.corpus_glyph"), label: t("caseDesk.rail.corpus"), match: () => false }] : []),
    ...(isAdmin
      ? [{ href: "/desk/overview", glyph: t("caseDesk.rail.hall_glyph"), label: t("caseDesk.rail.hall"), match: (p: string) => p.startsWith("/desk/overview"), wideOnly: true }]
      : []),
    ...(hasPermission("social.moderate")
      ? [{ href: "/moderation", glyph: t("caseDesk.rail.moderation_glyph"), label: t("caseDesk.rail.moderation"), match: () => false, wideOnly: true }]
      : []),
  ];
  const name = user?.display_name || user?.username || "";

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-toast focus:bg-[oklch(var(--color-surface-1))] focus:px-3 focus:py-2 focus:text-sm"
      >
        {t("nav.skip_to_main")}
      </a>
      <ImpersonationBanner />
      <MfaRequiredBanner />
      <PasswordChangeRedirect />
      <div className={s.shell} data-testid="desk-shell">
        <nav className={s.rail} aria-label={t("caseDesk.rail.label")} data-testid="desk-rail">
          <span className={s.railMark}>
            <BrandMark size={28} tone="gold" />
          </span>
          {doors.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className={`${s.door} ${d.wideOnly ? s.doorWide : ""}`}
              aria-current={d.match(pathname) ? "page" : undefined}
              aria-label={d.label}
            >
              <span className={doorGlyphClass(d.glyph)} aria-hidden="true" data-testid="desk-door-glyph">
                {d.glyph}
              </span>
              <span className={s.doorLabel} aria-hidden="true">
                {d.label}
              </span>
            </Link>
          ))}
          {/* 窄屏第四格:「我」(本人与设置)。宽屏是底部的头像。 */}
          <Link href="/profile" className={`${s.door} ${s.doorNarrow}`} aria-label={t("caseDesk.rail.me")}>
            <span className={doorGlyphClass(t("caseDesk.rail.me_glyph"))} aria-hidden="true" data-testid="desk-door-glyph">
              {t("caseDesk.rail.me_glyph")}
            </span>
            <span className={s.doorLabel} aria-hidden="true">
              {t("caseDesk.rail.me")}
            </span>
          </Link>
          <div className={s.railFoot}>
            <Link href="/profile" className={s.me} title={name} aria-label={t("caseDesk.rail.me")}>
              <span aria-hidden="true">{[...name][0] ?? "·"}</span>
            </Link>
          </div>
        </nav>
        <main id="main" tabIndex={-1} className={s.main} data-testid="app-content">
          {expired ? <HallViewExpired /> : children}
        </main>
      </div>
    </>
  );
}
