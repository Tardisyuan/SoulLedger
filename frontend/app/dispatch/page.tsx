"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("dispatch.title") || "Dispatch Management"}</h1>
          <p className="text-ink-subtle mt-1">Cross-tenant soul dispatch</p>
        </div>
        <Link
          href="/dispatch/propose"
          className="bg-amber-500 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-400 transition-colors"
        >
          {t("dispatch.propose") || "Propose Dispatch"}
        </Link>
      </div>

      {/* Pending Proposals */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-ink mb-3">{t("dispatch.pending") || "Pending Proposals"}</h2>
        {loadingProposed ? (
          <p className="text-ink-muted">{t("common.loading")}</p>
        ) : proposed.length === 0 ? (
          <p className="text-ink-muted bg-surface-1 rounded-lg p-4 border border-hairline">No pending proposals</p>
        ) : (
          <div className="space-y-3">
            {proposed.map((d: any) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-3">{t("dispatch.history") || "History"}</h2>
        {loadingHistory ? (
          <p className="text-ink-muted">{t("common.loading")}</p>
        ) : history.length === 0 ? (
          <p className="text-ink-muted bg-surface-1 rounded-lg p-4 border border-hairline">No dispatch history</p>
        ) : (
          <div className="space-y-3">
            {history.map((d: any) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
      </section>
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
    <div className="bg-surface-1 border border-hairline rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink">Soul #{dispatch.soul}</p>
          <p className="text-sm text-ink-subtle">
            {dispatch.source_tenant_code} → {dispatch.target_tenant_code}
          </p>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[dispatch.status] || "bg-gray-500/20"}`}>
          {dispatch.status}
        </span>
      </div>
      {dispatch.reason && (
        <p className="mt-2 text-sm text-ink-muted">{dispatch.reason}</p>
      )}
    </div>
  );
}
