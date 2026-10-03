"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

export const AUDIT_PATH = "/audit";
export const LOGIN_LOG_PATH = "/audit/logins";

/**
 * 「审计日志」「登录日志」: two routes under /audit, same strip as AssistAdminTabs.
 * The login-log tab is ADMIN-only because `LoginLogViewSet` is
 * (`IsAdminPermission`, backend/apps/authentication/views.py) while the audit
 * log itself is `audit.read` (ADMIN and MODERATOR) — a MODERATOR sees one tab.
 */
export function AuditTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const tab = (key: "audit" | "logins", href: string) => (
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
      <RequireAdmin>{tab("logins", LOGIN_LOG_PATH)}</RequireAdmin>
    </>
  );
}
