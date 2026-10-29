"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * /admin/stats has been merged into /dashboard as the "ledger" tab (the two
 * pages rendered near-identical cards off the same ledgerApi.statsOverview()
 * call). This route stays alive as a redirect so existing menu entries and
 * bookmarks keep working; the gate (`ledger.read`, the overview's code since
 * 2026-10-29) lives on the dashboard page itself, around the ledger tab content.
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


/* 与它跳去的账本页签同一道门:`/ledger/stats/overview/` 从 2026-10-29 起只要 `ledger.read`(第 33 条),
   此前后端硬编码 ADMIN,这里是 RequireAdmin。 */
export default function AdminStatsRedirect() {
  return (
    <RequirePermission permissions="ledger.read" fallback={<PermissionDenied permission="ledger.read" />}>
      <AdminStatsRedirectContent />
    </RequirePermission>
  );
}
