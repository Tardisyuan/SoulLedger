"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentAppealKeys, judgmentAppealsApi, type JudgmentAppeal } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { PageSection } from "@/components/ui/page-section";
import { ListSkeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/src/components/ui/PageError";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Button } from "@/src/components/ui/Button";
import { StatusBadge, VerdictBadge } from "@/src/components/ui/StatusBadge";
import { CaseNumber } from "@/src/components/ui/DomainValue";
import { AppealDecideDialog } from "@/src/components/judgment/AppealDecideDialog";
import { APPEAL_STATUS_TONES, appealRefusalMessage } from "@/src/components/judgment/appealDisplay";

/*
 * 复核页(Design 第五十二批 W-2):左原判、右申诉,各占一半,标签行对齐,方便横着比。
 * 判词、理由、新证据、复核意见都是人写的话:衬线(DESIGN.md「Things a person said」)。
 * 作出原判的官员(`original_officer_ids`)的「认领复核」置灰,原因写在按钮正下方。认领后换成「作出结论」。
 */

const LABEL = "text-xs text-[oklch(var(--color-ink-subtle))]";
const PROSE = "font-serif text-sm text-[oklch(var(--color-ink))] whitespace-pre-wrap";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 py-2 border-b border-[oklch(var(--color-rule))]">
      <span className={LABEL}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Decision({ appeal }: { appeal: JudgmentAppeal }) {
  const { t, formatDate } = useI18n();
  return (
    <PageSection title={t(`appeals.status.${appeal.status}`)}>
      {appeal.status === "AMENDED" && (
        <Row label={t("appeals.new_verdict")}>
          <span className="inline-flex items-center gap-2 text-sm">
            <VerdictBadge verdict={appeal.original_verdict} />→<VerdictBadge verdict={appeal.new_verdict} />
          </span>
        </Row>
      )}
      {appeal.decision_note && (
        <Row label={t("appeals.decision_note")}>
          <p className={PROSE}>{appeal.decision_note}</p>
        </Row>
      )}
      {appeal.decided_at && (
        <Row label={t("appeals.col.reviewer")}>
          <span className="text-sm">
            {appeal.reviewer_name ?? <MissingValue kind="unrecorded" />} · {t("appeals.decided_at", { date: formatDate(appeal.decided_at) })}
          </span>
        </Row>
      )}
      {appeal.compensations.length > 0 && (
        <Row label={t("appeals.compensation")}>
          <ul className="font-mono text-xs space-y-0.5">
            {appeal.compensations.map((c) => {
              const order = c.order;
              return (
                <li key={c.id}>
                  {order === null ? `${c.description} · +${c.weight}` : t("appeals.compensation_row", { order: String(order), weight: String(c.weight) })}
                </li>
              );
            })}
          </ul>
        </Row>
      )}
    </PageSection>
  );
}

function AppealReviewContent({ id }: { id: string }) {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [deciding, setDeciding] = useState(false);
  const query = useQuery({ queryKey: judgmentAppealKeys.detail(id), queryFn: () => judgmentAppealsApi.get(id).then((r) => r.data) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: judgmentAppealKeys.all });
  const claim = useMutation({
    mutationFn: () => judgmentAppealsApi.claim(id),
    onSuccess: () => {
      showToast(t("appeals.claimed_toast"), "success");
      void refresh();
    },
    onError: (err) => {
      showToast(appealRefusalMessage(err, t), "error");
      void refresh();
    },
  });

  if (query.isLoading) return <ListSkeleton count={3} />;
  // A deleted or other-hall appeal answers 404: say it is not there, not that the request failed.
  if ((query.error as { response?: { status?: number } } | null)?.response?.status === 404)
    return <EmptyState title={t("notifications.open_failed")} />;
  if (query.isError || !query.data) return <QueryError onRetry={() => query.refetch()} />;
  const appeal = query.data;
  const original = !!user && appeal.original_officer_ids.includes(user.id);
  const mine = !!user && appeal.reviewer === user.id;

  return (
    <PageShell
      variant="page"
      title={t("appeals.decide_title", { case: appeal.case_number })}
      backLink={
        <Link href="/judgment/appeals" className="text-sm text-[oklch(var(--color-ink-muted))] underline underline-offset-2">
          ← {t("appeals.queue_title")}
        </Link>
      }
      actions={
        <RequirePermission permissions="judgment.execute">
          {appeal.status === "PENDING" && (
            <div className="flex flex-col items-end gap-1">
              <Button type="button" data-testid="appeal-claim" disabled={original} loading={claim.isPending} onClick={() => claim.mutate()}>
                {t("appeals.claim")}
              </Button>
              {original && (
                <p data-testid="appeal-claim-reason" className="text-xs text-[oklch(var(--color-ink-muted))] max-w-xs text-right">
                  {t("appeals.claim_disabled_original")}
                </p>
              )}
            </div>
          )}
          {appeal.status === "IN_REVIEW" && mine && (
            <Button type="button" data-testid="appeal-decide" onClick={() => setDeciding(true)}>
              {t("appeals.decide_action")}
            </Button>
          )}
        </RequirePermission>
      }
    >
      <p className="flex flex-wrap items-center gap-2 text-sm mb-4">
        <StatusBadge namespace="appeals.status" value={appeal.status} tone={APPEAL_STATUS_TONES[appeal.status]} />
        <span>{t("appeals.round", { round: String(appeal.round) })}</span>
        <span className={LABEL}>·</span>
        <Link href={`/souls/${appeal.soul}`} className="underline underline-offset-2">{appeal.soul_name}</Link>
        {appeal.status === "IN_REVIEW" && appeal.reviewer_name && (
          <span className={LABEL}>
            {t("appeals.col.reviewer")} {appeal.reviewer_name}
          </span>
        )}
      </p>
      <div className="grid gap-6 md:grid-cols-2" data-testid="appeal-split">
        <PageSection title={t("appeals.original_verdict")}>
          <Row label={t("judgment.case_number")}>
            <Link href={`/judgment/${appeal.judgment}`} className="underline underline-offset-2">
              <CaseNumber value={appeal.case_number} variant="inline" />
            </Link>
          </Row>
          <Row label={t("appeals.original_verdict")}>
            <VerdictBadge verdict={appeal.original_verdict} />
          </Row>
          <Row label={t("souls.detail.ledger.verdict_words")}>
            <p className={PROSE}>{appeal.judgment_notes || <MissingValue kind="unrecorded" />}</p>
          </Row>
        </PageSection>
        <PageSection title={t("appeals.file")}>
          <Row label={t("appeals.col.filed_at")}>
            <span className="font-mono text-xs">{formatDateTime(appeal.create_time)}</span>
          </Row>
          <Row label={t("appeals.reason_label")}>
            <p className={PROSE}>{appeal.reason}</p>
          </Row>
          {/* 「新证据 · 选填」是灵魂表单上的标签;官员这边只要前半句。 */}
          <Row label={t("appeals.evidence_label").split(" · ")[0]}>
            <p className={PROSE}>{appeal.evidence || <MissingValue kind="unrecorded" />}</p>
          </Row>
        </PageSection>
      </div>
      {(appeal.status === "UPHELD" || appeal.status === "AMENDED") && (
        <div className="mt-6">
          <Decision appeal={appeal} />
        </div>
      )}
      {deciding && <AppealDecideDialog appeal={appeal} isOpen onClose={() => setDeciding(false)} />}
    </PageShell>
  );
}

export default function AppealReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      <AppealReviewContent id={id} />
    </RequirePermission>
  );
}
