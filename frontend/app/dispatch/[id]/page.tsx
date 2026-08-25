"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { badgeVariants } from "@/src/components/ui/Badge";

const STATUS_COLORS: Record<string, string> = {
  PROPOSED: "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))]",
  APPROVED: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))]",
  REJECTED: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))]",
  EXECUTED: "bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))]",
  CANCELLED: "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))]",
};

const STATUS_LABELS: Record<string, string> = {
  PROPOSED: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTED: "Executed",
  CANCELLED: "Cancelled",
};

/**
 * Badge geometry from `Badge`, fill from the table above.
 *
 * `tone: null` skips the variant *and* its default, so the five token pairs
 * above are the only colours in the class list — nothing to lose a merge
 * against. `border-transparent` because those pairs name no border colour
 * while `Badge`'s base carries `border`, which is a width: without it the
 * badge inherits `borderColor.DEFAULT` and grows a hairline this row never
 * had. Same helper, same reasoning as `app/death-sync/page.tsx`.
 *
 * The table stays a `--color-status-*` map rather than moving to a tone.
 * `src/__tests__/statusTokenLayering.test.ts` registers it by name —
 * "PROPOSED/APPROVED/REJECTED/EXECUTED/CANCELLED — the state of a request
 * being processed, not a judgement about a soul" — and that register is
 * checked in both directions, so quietly converting it here would delete a
 * recorded decision as a side effect of a layout change. The two lists on
 * `app/dispatch/page.tsx` are new code and go through tones instead.
 */
function statusBadgeClass(status: string): string {
  return cn(badgeVariants({ tone: null }), "border-transparent", STATUS_COLORS[status] || "");
}

export default function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatDateTime } = useI18n();
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

  /* The back control goes in PageShell's `backLink` slot as a real <Link>.
     It was a bare `←` glued to the label in a flex row above the title; the
     slot puts it on the same line as the eyebrow, where every detail page's
     back control now sits. */
  const backLink = (
    <Link
      href="/dispatch"
      className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline"
    >
      ← {t("common.back_to_list")}
    </Link>
  );

  if (isLoading) {
    return (
      <PageShell variant="prose" backLink={backLink} title={t("dispatch.detail_title")}>
        <Skeleton className="h-48 w-full" />
      </PageShell>
    );
  }

  if (!dispatch) {
    return (
      <PageShell variant="prose" backLink={backLink} title={t("dispatch.detail_title")}>
        <EmptyState title="Dispatch not found." />
      </PageShell>
    );
  }

  const isProposed = dispatch.status === "PROPOSED";
  const isApproved = dispatch.status === "APPROVED";
  // STATUS_LABELS is real copy and beats the convention's generic
  // "unrecognized" wording, but the raw member is never the fallback (§4.6).
  const statusResolved = resolveEnumDisplay(t, "dispatch.states", dispatch.status);
  const statusLabel =
    statusResolved.state === "known"
      ? statusResolved.label
      : STATUS_LABELS[dispatch.status] || statusResolved.label || t("common.value.unrecorded");

  /* Hoisted out of the `actions=` slot deliberately. The §4.6 contract test
     reads the three lines above a string-form enum render looking for
     `title={rawMember}`, and inside the slot the nearest `title=` above
     `{statusLabel}` was PageShell's own `title` PROP — a page heading, not an
     HTML attribute, and `t(...)` rather than the member. The check reported it
     and was right to: two different things spelled `title=` within three lines
     is exactly as ambiguous to a reader as to the regex. */
  const statusBadge = (
    <span title={dispatch.status} className={statusBadgeClass(dispatch.status)}>
      {statusLabel}
    </span>
  );

  return (
    <PageShell
      variant="prose"
      backLink={backLink}
      title={t("dispatch.detail_title")}
      actions={statusBadge}
    >
      {/* Info Card */}
      <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.soul")}</p>
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{dispatch.soul_name || dispatch.soul}</p>
          </div>
          <div>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.status")}</p>
            <p title={dispatch.status} className="text-04 font-medium text-[hsl(var(--color-ink))]">{statusLabel}</p>
          </div>
          <div>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.source_tenant")}</p>
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{dispatch.source_tenant_code}</p>
          </div>
          <div>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.target_tenant")}</p>
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{dispatch.target_tenant_code}</p>
          </div>
          <div>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.proposed_by")}</p>
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{dispatch.dispatched_by_name || dispatch.dispatched_by}</p>
          </div>
          <div>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.proposed_at")}</p>
            {/* Timestamps take the meta slot (text-02) and tabular figures, so
                three of them stacked in a grid line up digit for digit. */}
            <p className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink))]">{formatDateTime(dispatch.proposed_at)}</p>
          </div>
          {dispatch.decided_at && (
            <div>
              <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.decided_at")}</p>
              <p className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink))]">{formatDateTime(dispatch.decided_at)}</p>
            </div>
          )}
          {dispatch.executed_at && (
            <div>
              <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("dispatch.executed_at")}</p>
              <p className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink))]">{formatDateTime(dispatch.executed_at)}</p>
            </div>
          )}
        </div>

        {dispatch.reason && (
          <div className="mt-4 pt-4 border-t border-[hsl(var(--color-hairline))]">
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-1">{t("dispatch.reason")}</p>
            <p className="text-04 text-[hsl(var(--color-ink))]">{dispatch.reason}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {isProposed && (
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-6">
          <h2 className="text-06 font-semibold text-[hsl(var(--color-ink))] mb-4">{t("dispatch.actions")}</h2>
          <div className="flex gap-3">
            <RequirePermission permissions="dispatch.approve">
              <Button
                type="button"
                variant="primary"
                onClick={() => approveMutation.mutate()}
                loading={approveMutation.isPending}
              >
                {t("dispatch.approve")}
              </Button>
            </RequirePermission>

            <RequirePermission permissions="dispatch.reject">
              <Button type="button" variant="danger" onClick={() => setShowRejectModal(true)}>
                {t("dispatch.reject")}
              </Button>
            </RequirePermission>
          </div>
        </div>
      )}

      {isApproved && (
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-6">
          <h2 className="text-06 font-semibold text-[hsl(var(--color-ink))] mb-4">{t("dispatch.actions")}</h2>
          <RequirePermission permissions="dispatch.execute">
            <Button type="button" variant="primary" onClick={() => setShowExecuteModal(true)}>
              {t("dispatch.execute")}
            </Button>
          </RequirePermission>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--color-surface-1))] p-6 w-full max-w-md border border-[hsl(var(--color-hairline))]">
            <h3 className="text-05 font-semibold text-[hsl(var(--color-ink))] mb-4">{t("dispatch.reject_reason")}</h3>
            <TextAreaField
              label={t("dispatch.reason")}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder={t("dispatch.reject_placeholder")}
              className="mb-4"
            />
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setShowRejectModal(false); setRejectReason(""); }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => { rejectMutation.mutate(); setShowRejectModal(false); }}
                loading={rejectMutation.isPending}
              >
                {t("dispatch.confirm_reject")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Execute Modal */}
      {showExecuteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--color-surface-1))] p-6 w-full max-w-md border border-[hsl(var(--color-hairline))]">
            <h3 className="text-05 font-semibold text-[hsl(var(--color-ink))] mb-2">{t("dispatch.confirm_execute")}</h3>
            <p className="text-04 text-[hsl(var(--color-ink-muted))] mb-4">
              {t("dispatch.execute_warning")}
            </p>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowExecuteModal(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => { executeMutation.mutate(); setShowExecuteModal(false); }}
                loading={executeMutation.isPending}
              >
                {t("dispatch.confirm_execute")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
