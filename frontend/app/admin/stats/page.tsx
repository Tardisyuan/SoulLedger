"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

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

  // `role="status"` with a name. An audit read this page as "missing an
  // <h1>"; it is a redirect shim with no content, so a heading would be the
  // wrong fix — but the spinner had no accessible name at all, so a screen
  // reader announced nothing at all while the route moved out from under it.
  // (`app/judgment/queue/page.tsx` was flagged the same way and is simply
  // fine: its <h1> lives in JudgmentQueueConsole.tsx:167, outside the file
  // that was grepped.)
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="min-h-[calc(100vh-4rem)] bg-[hsl(var(--color-canvas))] flex items-center justify-center"
    >
      <div aria-hidden="true" className="relative w-16 h-16">
        <div className="absolute inset-0 border-4 border-[hsl(var(--color-accent))]/20 rounded-full" />
        <div className="absolute inset-0 border-4 border-transparent border-t-[hsl(var(--color-accent))] rounded-full animate-spin" />
      </div>
    </div>
  );
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
