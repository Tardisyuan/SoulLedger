"use client";

import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";

/**
 * 被要求开启两步验证而还没开启的人,登录后一直看到这条(用户 2026-10-09 决定:不在登录第二步
 * 直接进向导,先让他进官员台)。读的是登录 payload 里的 `mfa_required` / `mfa_enabled`
 * (`TenantContext` 的 user 信封),向导「完成」后个人中心用 `setUser` 把它翻过去,不另发请求。
 * 样子沿用 v3 的警示条(`ConnectionBanner`),但在文档流里、在工具条下面,不盖按钮。
 */
export function MfaRequiredBanner() {
  const { t } = useI18n();
  const { user } = useTenant();
  if (!user || !user.mfa_required || user.mfa_enabled) return null;
  return (
    <div
      role="status"
      data-testid="mfa-required-banner"
      className="flex min-h-9 items-center gap-3 border-b border-[oklch(var(--color-line))] border-t-2 border-t-[oklch(var(--color-warning))] bg-[oklch(var(--color-warning-tint))] px-4 text-xs text-[oklch(var(--color-warning))] md:px-8"
    >
      <span aria-hidden="true">!</span>
      <span className="min-w-0 truncate" title={t("mfa.banner.text")}>{t("mfa.banner.text")}</span>
      <span className="flex-1" aria-hidden="true" />
      <Link href="/profile#mfa" className="shrink-0 underline underline-offset-2">
        {t("mfa.banner.action")}
      </Link>
    </div>
  );
}
