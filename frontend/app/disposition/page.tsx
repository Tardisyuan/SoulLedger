"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { dispositionApi, type Disposition } from "@soulledger/core/api";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DomainText } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { MenuGloss } from "@/src/components/layout/MenuGloss";

export default function DispositionPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showExecuteModal, setShowExecuteModal] = useState<string | null>(null);

  const { data: dispositionsResponse, isLoading, isError, refetch } = useQuery({
    queryKey: ["dispositions"],
    queryFn: () => dispositionApi.list().then(r => r.data),
    enabled: !!user,
  });

  // /disposition/ is a paginated ModelViewSet list, so `results` is always
  // present (an empty array included) and the old `|| dispositionsResponse`
  // fallback could never be reached.
  const dispositions = dispositionsResponse?.results ?? [];

  const executeMutation = useMutation({
    mutationFn: (id: string) => dispositionApi.execute(id),
    onSuccess: () => {
      showToast(t("disposition.executed_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["dispositions"] });
      setShowExecuteModal(null);
    },
    onError: () => showToast(t("disposition.execute_error"), "error"),
  });

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("disposition.title")}
          <MenuGloss path="/disposition" />
        </>
      }
      subtitle={t("disposition.subtitle")}
      isLoading={isLoading}
      skeleton={<ListSkeleton count={5} />}
      // `isError ||`, not `dispositions.length === 0` alone. A failed request
      // yields `results ?? []`, which is empty, so "the server is down" and
      // "no dispositions have been filed" rendered the same words.
      isEmpty={isError || dispositions.length === 0}
      empty={
        isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <EmptyState
            title={t("disposition.list")}
            reason={t("disposition.no_dispositions")}
          />
        )
      }
    >
      <div className="space-y-3">
        {dispositions.map((d: Disposition) => (
          <div key={d.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-03 font-medium text-[hsl(var(--color-ink))]">
                  {t("disposition.soul")}:{" "}
                  <Link href={`/souls/${d.soul}`} className="text-[hsl(var(--color-accent-ink))] hover:underline">
                    {d.soul_name || d.soul}
                  </Link>
                </p>
                <p className="text-03 text-[hsl(var(--color-ink-subtle))] mt-1">
                  {t("disposition.realm")}: <DomainText value={d.realm_name || d.destination_realm} />
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.is_executed ? (
                  <Badge tone="success">{t("disposition.executed")}</Badge>
                ) : d.is_eternal ? (
                  <Badge tone="info">{t("disposition.eternal")}</Badge>
                ) : (
                  <RequirePermission permissions="disposition.execute">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setShowExecuteModal(d.id)}
                    >
                      {t("disposition.execute")}
                    </Button>
                  </RequirePermission>
                )}
              </div>
            </div>
            {d.notes && (
              <p className="mt-2 text-03 text-[hsl(var(--color-ink-muted))]">{d.notes}</p>
            )}
          </div>
        ))}
      </div>

      {/* The second hand-rolled `fixed inset-0` — same missing apparatus as
          `app/recycle-bin`: no `role="dialog"`, no `aria-modal`, no focus
          move, no Escape, no focus trap, no focus return. Executing a
          disposition is what sends a soul to its realm; it is not a dialog to
          leave dismissible by a stray Tab into the page behind it.

          Also note what the old markup did with `z-50` while the rest of the
          app is on the `z-dialog` token — a scrim that can be outranked is a
          scrim that is sometimes not there. */}
      <ConfirmDialog
        isOpen={showExecuteModal !== null}
        title={t("disposition.confirm_execute")}
        message={t("disposition.execute_warning")}
        confirmText={t("disposition.confirm_execute")}
        variant="danger"
        confirmLoading={executeMutation.isPending}
        onCancel={() => setShowExecuteModal(null)}
        onConfirm={() => showExecuteModal && executeMutation.mutate(showExecuteModal)}
      />
    </PageShell>
  );
}
