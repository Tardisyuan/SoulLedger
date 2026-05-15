"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton, CardSkeleton, ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";

export default function DispatchPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: proposed = [], isLoading: loadingProposed } = useQuery({
    queryKey: ["dispatch", "proposed"],
    queryFn: () => dispatchApi.proposed().then(r => r.data),
    enabled: !!user,
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ["dispatch", "history"],
    queryFn: () => dispatchApi.history().then(r => r.data),
    enabled: !!user,
  });

  return (
    <div className="p-6">
      {/* Page Header - rendered immediately */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))]">{t("dispatch.title")}</h1>
          <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("dispatch.subtitle")}</p>
        </div>
        <Link
          href="/dispatch/propose"
          className="bg-[hsl(var(--color-accent))] text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-[hsl(var(--color-accent))] transition-colors"
        >
          {t("dispatch.propose")}
        </Link>
      </div>

      {/* Pending Proposals - skeleton while loading */}
      <PageSection title={t("dispatch.pending")} isLoading={loadingProposed} className="mb-8">
        {loadingProposed ? (
          <ListSkeleton count={3} />
        ) : proposed.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-muted))] bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">{t("dispatch.no_pending") || "No pending proposals"}</p>
        ) : (
          <div className="space-y-3">
            {proposed.map((d: any) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
      </PageSection>

      {/* History - skeleton while loading */}
      <PageSection title={t("dispatch.history")} isLoading={loadingHistory}>
        {loadingHistory ? (
          <ListSkeleton count={5} />
        ) : history.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-muted))] bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">{t("dispatch.no_history") || "No dispatch history"}</p>
        ) : (
          <div className="space-y-3">
            {history.map((d: any) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}

function DispatchCard({ dispatch }: { dispatch: any }) {
  const statusColors: Record<string, string> = {
    PROPOSED: "bg-yellow-500/20 text-yellow-400",
    APPROVED: "bg-green-500/20 text-green-400",
    REJECTED: "bg-red-500/20 text-red-400",
    EXECUTED: "bg-blue-500/20 text-blue-400",
    CANCELLED: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-[hsl(var(--color-ink))]">Soul #{dispatch.soul}</p>
          <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
            {dispatch.source_tenant_code} → {dispatch.target_tenant_code}
          </p>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[dispatch.status] || "bg-gray-500/20"}`}>
          {dispatch.status}
        </span>
      </div>
      {dispatch.reason && (
        <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))]">{dispatch.reason}</p>
      )}
    </div>
  );
}
