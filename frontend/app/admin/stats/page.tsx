"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * /admin/stats has been merged into /dashboard as the "ledger" tab (the two
 * pages rendered near-identical cards off the same ledgerApi.statsOverview()
 * call). This route stays alive as a redirect so existing menu entries and
 * bookmarks keep working; the ADMIN-only gate now lives on the dashboard
 * page itself (RequirePermission around the ledger tab content).
 */
function AdminStatsRedirectContent() {
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    router.replace("/dashboard?tab=ledger");
  }, [router]);

  // `PageSpinner` carries the named `role="status"` this shim needs (a redirect
  // with no content has nothing else to announce) and is the one busy screen
  // `app/admin/stats/loading.tsx` already uses. The hand-rolled double ring
  // that stood here was the last circle on this route (规范 v1: 圆角只给头像).
  //
  // No chart lives here: /admin/stats is only a redirect. The ledger tab it
  // lands on (`/dashboard?tab=ledger`) already draws the 图例账 and the
  // histogram, with no pie or donut.
  return <PageSpinner label={t("common.loading")} />;
}


/* `RequireAdmin`,不是 `RequirePermission permissions="ADMIN"` —— 后者把角色名当
   码名用,只因为 `hasPermission` 对 ADMIN 短路才碰巧成立(见 RequirePermission.tsx
   里 RequireAdmin 的注释)。这两页对应的后端确实是硬编码的 ADMIN,不是某个码名。 */
export default function AdminStatsRedirect() {
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <AdminStatsRedirectContent />
    </RequireAdmin>
  );
}
