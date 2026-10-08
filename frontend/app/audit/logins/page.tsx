"use client";

import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { LoginLogPanel } from "@/src/components/audit/LoginLogPanel";

/* 审计 · 登录日志. `RequireAdmin`, not a codename: `LoginLogViewSet` is
   `IsAdminPermission` and no `login_log.*` codename exists (see its docstring),
   so the 权限 page cannot grant it. Non-ADMIN never mounts the panel, so no
   request is made at all. */
export default function LoginLogRoute() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.records")) });
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <LoginLogPanel />
    </RequireAdmin>
  );
}
