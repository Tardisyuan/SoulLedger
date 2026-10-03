"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

export const REGISTRATIONS_PATH = "/death-sync";
export const API_KEYS_PATH = "/death-sync/api-keys";

/**
 * 「登记记录」「接入密钥」: two routes under /death-sync, same strip as AssistAdminTabs.
 * The keys tab is ADMIN-only because `ExternalApiKeyViewSet` is
 * (`IsAdminPermission`, backend/apps/death_sync/views.py): a tab that 403s is
 * worse than no tab.
 */
export function DeathSyncTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const tab = (key: "registrations" | "api_keys", href: string) => (
    <Link
      key={key}
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      className={`${TAB_BASE} ${pathname === href ? TAB_ON : TAB_OFF}`}
    >
      {t(`death_sync.tabs.${key}`)}
    </Link>
  );
  return (
    <>
      {tab("registrations", REGISTRATIONS_PATH)}
      <RequireAdmin>{tab("api_keys", API_KEYS_PATH)}</RequireAdmin>
    </>
  );
}
