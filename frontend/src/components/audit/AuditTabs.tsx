"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin, RequirePermission } from "@/src/components/rbac/RequirePermission";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

export const AUDIT_PATH = "/audit";
export const PERMISSION_CHANGES_PATH = "/audit/permissions";
export const AUDIT_STATS_PATH = "/audit/stats";
export const LOGIN_LOG_PATH = "/audit/logins";
export const SESSIONS_PATH = "/audit/sessions";

/**
 * 「审计日志」「权限变更」「统计」「登录日志」: routes under /audit, same strip as AssistAdminTabs.
 * 权限变更与统计同列表一样是 `audit.read`(第三十七批:版主也看统计)。
 * The login-log tab is ADMIN-only because `LoginLogViewSet` is
 * (`IsAdminPermission`, backend/apps/authentication/views.py) while the audit
 * log itself is `audit.read` (ADMIN and MODERATOR) — a MODERATOR sees one tab.
 * 「在线会话」is `session.manage` (2026-10-29: ADMIN by default, grantable in the matrix).
 */
export function AuditTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const tab = (key: "audit" | "permissions" | "stats" | "logins" | "sessions", href: string) => (
    <Link
      key={key}
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      className={`${TAB_BASE} ${pathname === href ? TAB_ON : TAB_OFF}`}
    >
      {t(`audit.tabs.${key}`)}
    </Link>
  );
  return (
    <>
      {tab("audit", AUDIT_PATH)}
      {tab("permissions", PERMISSION_CHANGES_PATH)}
      {tab("stats", AUDIT_STATS_PATH)}
      <RequireAdmin>{tab("logins", LOGIN_LOG_PATH)}</RequireAdmin>
      <RequirePermission permissions="session.manage">{tab("sessions", SESSIONS_PATH)}</RequirePermission>
    </>
  );
}
