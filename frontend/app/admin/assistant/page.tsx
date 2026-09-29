"use client";

import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { AssistAdminConfigPage } from "@/src/components/assist-admin/ConfigPage";

/* 助手管理 · 配置与测试 (docs/ARCHITECTURE-assist-admin.md). `RequireAdmin`, not a
   codename: the backend checks `role == "ADMIN"` so the 权限 page cannot grant it.
   Non-ADMIN never mounts the page, so no config request is made at all. */
export default function AssistAdminConfigRoute() {
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <AssistAdminConfigPage />
    </RequireAdmin>
  );
}
