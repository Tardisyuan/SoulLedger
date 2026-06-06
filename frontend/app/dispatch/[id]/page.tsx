"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi, type DispatchRecord } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

const STATUS_COLORS: Record<string, string> = {
  PROPOSED: "bg-[hsl(var(--color-status-warning)/0.2)] text-[hsl(var(--color-status-warning))]",
  APPROVED: "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]",
  REJECTED: "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]",
  EXECUTED: "bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]",
  CANCELLED: "bg-[hsl(var(--color-status-lost)/0.2)] text-[hsl(var(--color-status-lost))]",
};

const STATUS_LABELS: Record<string, string> = {
  PROPOSED: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTED: "Executed",
  CANCELLED: "Cancelled",
};

export default function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showExecuteModal, setShowExecuteModal] = useState(false);

  const { data: dispatch, isLoading } = useQuery({
    queryKey: ["dispatch", "detail", id],
    queryFn: () => dispatchApi.get(id).then(r => r.data),
    enabled: !!user && !!id,
  });

  const approveMutation = useMutation({
    mutationFn: () => dispatchApi.approve(id),
    onSuccess: () => {
      showToast(t("dispatch.approved_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      router.push("/dispatch");
    },
    onError: () => showToast(t("dispatch.approve_error"), "error"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => dispatchApi.reject(id, rejectReason),
    onSuccess: () => {
      showToast(t("dispatch.rejected_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      router.push("/dispatch");
    },
    onError: () => showToast(t("dispatch.reject_error"), "error"),
  });

  const executeMutation = useMutation({
    mutationFn: () => dispatchApi.execute(id),
    onSuccess: () => {
      showToast(t("dispatch.executed_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      router.push("/dispatch");
    },
    onError: () => showToast(t("dispatch.execute_error"), "error"),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl">
        <Skeleton className="h-8 w-64 mb-6" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!dispatch) {
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-[hsl(var(--color-ink-muted))]">Dispatch not found.</p>
        <Link href="/dispatch" className="text-[hsl(var(--color-accent))] hover:underline mt-2 inline-block">
          {t("common.back_to_list")}
        </Link>
      </div>
    );
  }

  const isProposed = dispatch.status === "PROPOSED";
  const isApproved = dispatch.status === "APPROVED";

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dispatch" className="text-[hsl(var(--color-accent))] hover:underline">
          ← {t("common.back_to_list")}
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))]">
          {t("dispatch.detail_title")}
        </h1>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[dispatch.status] || ""}`}>
          {STATUS_LABELS[dispatch.status] || dispatch.status}
        </span>
      </div>

      {/* Info Card */}
      <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.soul")}</p>
            <p className="font-medium text-[hsl(var(--color-ink))]">{dispatch.soul_name || dispatch.soul}</p>
          </div>
          <div>
            <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.status")}</p>
            <p className="font-medium text-[hsl(var(--color-ink))]">{STATUS_LABELS[dispatch.status]}</p>
          </div>
          <div>
            <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.source_tenant")}</p>
            <p className="font-medium text-[hsl(var(--color-ink))]">{dispatch.source_tenant_code}</p>
          </div>
          <div>
            <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.target_tenant")}</p>
            <p className="font-medium text-[hsl(var(--color-ink))]">{dispatch.target_tenant_code}</p>
          </div>
          <div>
            <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.proposed_by")}</p>
            <p className="font-medium text-[hsl(var(--color-ink))]">{dispatch.dispatched_by_name || dispatch.dispatched_by}</p>
          </div>
          <div>
            <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.proposed_at")}</p>
            <p className="font-medium text-[hsl(var(--color-ink))]">{new Date(dispatch.proposed_at).toLocaleString()}</p>
          </div>
          {dispatch.decided_at && (
            <div>
              <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.decided_at")}</p>
              <p className="font-medium text-[hsl(var(--color-ink))]">{new Date(dispatch.decided_at).toLocaleString()}</p>
            </div>
          )}
          {dispatch.executed_at && (
            <div>
              <p className="text-sm text-[hsl(var(--color-ink-subtle))]">{t("dispatch.executed_at")}</p>
              <p className="font-medium text-[hsl(var(--color-ink))]">{new Date(dispatch.executed_at).toLocaleString()}</p>
            </div>
          )}
        </div>

        {dispatch.reason && (
          <div className="mt-4 pt-4 border-t border-[hsl(var(--color-hairline))]">
            <p className="text-sm text-[hsl(var(--color-ink-subtle))] mb-1">{t("dispatch.reason")}</p>
            <p className="text-[hsl(var(--color-ink))]">{dispatch.reason}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {isProposed && (
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-6">
          <h2 className="font-semibold text-[hsl(var(--color-ink))] mb-4">{t("dispatch.actions")}</h2>
          <div className="flex gap-3">
            <RequirePermission permissions="dispatch.approve">
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="bg-[hsl(var(--color-status-success))] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {approveMutation.isPending ? t("common.loading") : t("dispatch.approve")}
              </button>
            </RequirePermission>

            <RequirePermission permissions="dispatch.reject">
              <button
                onClick={() => setShowRejectModal(true)}
                className="bg-[hsl(var(--color-status-error))] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
              >
                {t("dispatch.reject")}
              </button>
            </RequirePermission>
          </div>
        </div>
      )}

      {isApproved && (
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-6">
          <h2 className="font-semibold text-[hsl(var(--color-ink))] mb-4">{t("dispatch.actions")}</h2>
          <RequirePermission permissions="dispatch.execute">
            <button
              onClick={() => setShowExecuteModal(true)}
              className="bg-[hsl(var(--color-status-info))] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
            >
              {t("dispatch.execute")}
            </button>
          </RequirePermission>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-6 w-full max-w-md border border-[hsl(var(--color-hairline))]">
            <h3 className="font-semibold text-[hsl(var(--color-ink))] mb-4">{t("dispatch.reject_reason")}</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg px-3 py-2 text-[hsl(var(--color-ink))] mb-4"
              rows={3}
              placeholder={t("dispatch.reject_placeholder")}
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowRejectModal(false); setRejectReason(""); }}
                className="px-4 py-2 rounded-lg text-sm bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))]"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { rejectMutation.mutate(); setShowRejectModal(false); }}
                disabled={rejectMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm bg-[hsl(var(--color-status-error))] text-white hover:opacity-90 disabled:opacity-50"
              >
                {t("dispatch.confirm_reject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Execute Modal */}
      {showExecuteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-6 w-full max-w-md border border-[hsl(var(--color-hairline))]">
            <h3 className="font-semibold text-[hsl(var(--color-ink))] mb-2">{t("dispatch.confirm_execute")}</h3>
            <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">
              {t("dispatch.execute_warning")}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExecuteModal(false)}
                className="px-4 py-2 rounded-lg text-sm bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))]"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { executeMutation.mutate(); setShowExecuteModal(false); }}
                disabled={executeMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm bg-[hsl(var(--color-status-info))] text-white hover:opacity-90 disabled:opacity-50"
              >
                {t("dispatch.confirm_execute")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
