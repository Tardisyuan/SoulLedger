"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { dispositionApi, type Disposition } from "@/lib/api";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

export default function DispositionPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showExecuteModal, setShowExecuteModal] = useState<string | null>(null);

  const { data: dispositionsResponse, isLoading } = useQuery({
    queryKey: ["dispositions"],
    queryFn: () => dispositionApi.list().then(r => r.data),
    enabled: !!user,
  });

  const dispositions = dispositionsResponse?.results || dispositionsResponse || [];

  const executeMutation = useMutation({
    mutationFn: (id: string) => dispositionApi.execute(id),
    onSuccess: () => {
      showToast(t("disposition.executed_success") || "Disposition executed", "success");
      queryClient.invalidateQueries({ queryKey: ["dispositions"] });
      setShowExecuteModal(null);
    },
    onError: () => showToast(t("disposition.execute_error") || "Failed to execute", "error"),
  });

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">{t("disposition.title") || "Dispositions"}</h1>
          <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("disposition.subtitle") || "Soul disposition management"}</p>
        </div>
      </div>

      <PageSection title={t("disposition.list") || "All Dispositions"} isLoading={isLoading}>
        {isLoading ? (
          <ListSkeleton count={5} />
        ) : dispositions.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-muted))] bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
            {t("disposition.no_dispositions") || "No dispositions found."}
          </p>
        ) : (
          <div className="space-y-3">
            {dispositions.map((d: Disposition) => (
              <div key={d.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[hsl(var(--color-ink))]">Soul: {d.soul}</p>
                    <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
                      {t("disposition.realm") || "Realm"}: {d.destination_realm || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.is_executed ? (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]">
                        {t("disposition.executed") || "Executed"}
                      </span>
                    ) : d.is_eternal ? (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]">
                        {t("disposition.eternal") || "Eternal"}
                      </span>
                    ) : (
                      <RequirePermission permissions="disposition.execute">
                        <button
                          onClick={() => setShowExecuteModal(d.id)}
                          className="px-3 py-1 rounded text-xs font-medium bg-[hsl(var(--color-accent))] text-black hover:opacity-90"
                        >
                          {t("disposition.execute") || "Execute"}
                        </button>
                      </RequirePermission>
                    )}
                  </div>
                </div>
                {d.notes && (
                  <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))]">{d.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </PageSection>

      {/* Execute Confirmation Modal */}
      {showExecuteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-6 w-full max-w-md border border-[hsl(var(--color-hairline))]">
            <h3 className="font-semibold text-[hsl(var(--color-ink))] mb-2">{t("disposition.confirm_execute") || "Confirm Execution"}</h3>
            <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">
              {t("disposition.execute_warning") || "This will execute the disposition and transition the soul to REINCARNATING state."}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExecuteModal(null)}
                className="px-4 py-2 rounded-lg text-sm bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))]"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => executeMutation.mutate(showExecuteModal)}
                disabled={executeMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm bg-[hsl(var(--color-accent))] text-black hover:opacity-90 disabled:opacity-50"
              >
                {executeMutation.isPending ? t("common.loading") : t("disposition.confirm_execute") || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
