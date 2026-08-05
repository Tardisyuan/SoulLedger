"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /admin/stats has been merged into /dashboard as the "ledger" tab (the two
 * pages rendered near-identical cards off the same ledgerApi.statsOverview()
 * call). This route stays alive as a redirect so existing menu entries and
 * bookmarks keep working; the ADMIN-only gate now lives on the dashboard
 * page itself (RequirePermission around the ledger tab content).
 */
export default function AdminStatsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard?tab=ledger");
  }, [router]);

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-4 border-[hsl(var(--color-accent))]/20 rounded-full" />
        <div className="absolute inset-0 border-4 border-transparent border-t-[hsl(var(--color-accent))] rounded-full animate-spin" />
      </div>
    </div>
  );
}
