"use client";

import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { AssistAdminUsagePage } from "@/src/components/assist-admin/UsagePage";

/* 助手管理 · 实际用量 (docs/ARCHITECTURE-assist-admin.md §4). ADMIN only, as the config page. */
export default function AssistAdminUsageRoute() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <AssistAdminUsagePage />
    </RequireAdmin>
  );
}
