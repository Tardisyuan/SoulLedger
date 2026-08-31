"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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

  useEffect(() => {
    router.replace("/dashboard?tab=ledger");
  }, [router]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-canvas flex items-center justify-center">
      <div className="relative w-16 h-16">
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
