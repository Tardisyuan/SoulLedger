"use client";

import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { SessionsPanel } from "@/src/components/audit/SessionsPanel";

/* 审计 · 在线会话. `session.manage` (ADMIN by default), the same codename the endpoints check
   (backend/apps/authentication/admin_session_views.py). Without it the panel never mounts, so no request is made. */
export default function SessionsRoute() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.records")) });
  return (
    <RequirePermission permissions="session.manage" fallback={<PermissionDenied />}>
      <SessionsPanel />
    </RequirePermission>
  );
}
