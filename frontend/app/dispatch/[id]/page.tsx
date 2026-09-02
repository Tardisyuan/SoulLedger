"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi } from "@soulledger/core/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { BaseModal } from "@/src/components/ui/Modal";
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
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showExecuteModal, setShowExecuteModal] = useState(false);

  const { data: dispatch, isLoading, isError, refetch } = useQuery({
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

  // Split, and in this order. There was one branch: `!dispatch` rendered
  // "Dispatch not found." — hardcoded English — for a 500, a dropped
  // connection and a cross-tenant 403 alike, so the page told an operator who
  // had pasted someone else's URL exactly what it told an operator who had
  // typo'd an id. The error branch comes first because `dispatch` is also
  // undefined when the request failed.
  if (isError) {
    return (
      <PageShell variant="prose" backLink={backLink} title={t("dispatch.detail_title")}>
        <QueryError onRetry={() => refetch()} />
      </PageShell>
    );
  }

  if (!dispatch) {
    return (
      <PageShell variant="prose" backLink={backLink} title={t("dispatch.detail_title")}>
        <EmptyState title={t("dispatch.not_found")} />
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
            {/* `MissingValue`, NOT `|| dispatch.dispatched_by`.
                `dispatched_by` is the proposing user's integer primary key —
                `ForeignKey(User, on_delete=SET_NULL)` with no `source=`
                override, so DRF sends the pk. `dispatched_by_name` is
                `CharField(source="dispatched_by.username", allow_null=True)`,
                so it is null exactly when that account has been deleted, and
                the old `||` fallback fired precisely then: a bare user id
                printed where a person's name belongs.

                That is IDENTIFIER_POLICY clause 4 — an id standing where a
                name should be — which no exception suspends. "Nobody recorded
                this name" is a fact worth showing; a primary key is not. Same
                shape as `app/judgment/page.tsx`'s `soul_name`. */}
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">
              {dispatch.dispatched_by_name ? (
                dispatch.dispatched_by_name
              ) : (
                <MissingValue kind="unrecorded" reason={t("dispatch.proposer_account_removed")} />
              )}
            </p>
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
              {/* Was `approveMutation.mutate()` fired straight from the click,
                  while reject and execute — on this same page, in this same
                  card — each opened a confirmation. Approving is the
                  cross-tenant handover: it is the one of the three whose
                  consequence reaches another tenant's ledger. */}
              <Button
                type="button"
                variant="primary"
                onClick={() => setShowApproveModal(true)}
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

      {/* All three confirmations go through BaseModal (Base UI Dialog).
          The reject and execute dialogs were hand-rolled `fixed inset-0
          bg-black/50 … z-50` overlays — a third scrim dialect alongside
          Modal.tsx's own `bg-black/60 backdrop-blur-xs` and recycle-bin's
          `z-9999`, since renamed `z-dialog` — and being plain divs they had
          no focus trap, no Escape,
          and no `aria-modal`. Adding a third hand-rolled one for approve would
          have made the divergence permanent. */}
      <BaseModal
        isOpen={showApproveModal}
        onClose={() => setShowApproveModal(false)}
        title={t("dispatch.confirm_approve")}
        footer={
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={() => setShowApproveModal(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { approveMutation.mutate(); setShowApproveModal(false); }}
              loading={approveMutation.isPending}
            >
              {t("dispatch.approve")}
            </Button>
          </div>
        }
      >
        <p className="text-04 text-[hsl(var(--color-ink-muted))]">
          {t("dispatch.approve_warning")}
        </p>
      </BaseModal>

      <BaseModal
        isOpen={showRejectModal}
        onClose={() => { setShowRejectModal(false); setRejectReason(""); }}
        title={t("dispatch.reject_reason")}
        footer={
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
        }
      >
        <TextAreaField
          label={t("dispatch.reason")}
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          rows={3}
          placeholder={t("dispatch.reject_placeholder")}
        />
      </BaseModal>

      <BaseModal
        isOpen={showExecuteModal}
        onClose={() => setShowExecuteModal(false)}
        title={t("dispatch.confirm_execute")}
        footer={
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
        }
      >
        <p className="text-04 text-[hsl(var(--color-ink-muted))]">
          {t("dispatch.execute_warning")}
        </p>
      </BaseModal>
    </PageShell>
  );
}
