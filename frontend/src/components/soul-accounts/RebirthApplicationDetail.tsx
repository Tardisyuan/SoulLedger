"use client";

import Link from "next/link";
import type { OfficerRebirthApplication } from "@soulledger/core/api";
import { classifySoulAccountError, useDecideCrossCivilization } from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { failureKey, lifeNumber, rebirthBadgeClass } from "./soulAccountsView";

interface Props {
  application: OfficerRebirthApplication;
  onClose: () => void;
}

/** The first node of a rebirth workflow (`rebirth.REBIRTH_NODES[0]`: 判官初审, EVALUATION, by ROLE). */
const INITIAL_REVIEW_NODE_TYPE = "EVALUATION";

/**
 * Whether this user may be offered the cross-civilization choice: the
 * application is in its initial review (not an appeal), the current step is
 * the EVALUATION node, and that step names this user's role.
 *
 * Read off the application's own `current_step` — no extra workflow request.
 * Mirrors `rebirth.decide_cross_civilization` + `ApprovalNode.can_approve`
 * (ROLE branch; every rebirth node is ROLE). It only decides whether the
 * control is shown — the backend decides whether the write lands, and a
 * 403/409 is reported, not hidden.
 */
export function mayDecideCrossCivilization(
  application: Pick<OfficerRebirthApplication, "status" | "current_step">,
  userRole: string | undefined,
  hasApprove: boolean
): boolean {
  const step = application.current_step;
  return (
    hasApprove &&
    application.status === "UNDER_REVIEW" &&
    step !== null &&
    !step.is_appeal &&
    step.node_type === INITIAL_REVIEW_NODE_TYPE &&
    !!step.approver_role &&
    step.approver_role === userRole
  );
}

export function RebirthApplicationDetail({ application: a, onClose }: Props) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const decide = useDecideCrossCivilization();
  const canDecide = mayDecideCrossCivilization(a, user?.role, hasPermission("workflow.approve"));
  const step = a.current_step;

  const setCross = (value: boolean) =>
    decide.mutate(
      { id: a.id, value },
      {
        onSuccess: () => showToast(t("soul_accounts.rebirth.cross_saved"), "success"),
        onError: (error) =>
          showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.rebirth.cross_failed")), "error"),
      }
    );

  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="min-w-0 break-words text-[oklch(var(--color-ink))]">{value}</dd>
    </>
  );

  const crossText =
    a.cross_civilization === null
      ? t("soul_accounts.rebirth.cross.undecided")
      : t(a.cross_civilization ? "soul_accounts.rebirth.cross.yes" : "soul_accounts.rebirth.cross.no");

  const currentStep: React.ReactNode = step ? (
    <span className="inline-flex flex-wrap gap-1">
      <DomainEnum namespace="workflow.node_type" value={step.node_type} />
      <span aria-hidden="true">·</span>
      <DomainEnum namespace="users.roles" value={step.approver_role} />
      {step.is_appeal && <span>{t("soul_accounts.rebirth.step_appeal")}</span>}
    </span>
  ) : (
    <MissingValue kind="inapplicable" reason={t("soul_accounts.rebirth.no_current_node")} />
  );

  return (
    <BaseModal isOpen onClose={onClose} title={t("soul_accounts.rebirth.detail_title", { name: a.soul_name })}>
      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-03">
          {row(t("soul_accounts.fields.soul_code"), <span className="font-mono">{a.soul_code}</span>)}
          {row(t("soul_accounts.fields.cycle"), t("soul_accounts.life", { n: lifeNumber(a.cycle) }))}
          {row(t("soul_accounts.fields.status"), <DomainEnum namespace="soul_accounts.rebirth_status" value={a.status} className={rebirthBadgeClass(a.status)} />)}
          {row(t("soul_accounts.rebirth.fields.desired_form"), <DomainEnum namespace="reincarnation.forms" value={a.desired_form} />)}
          {row(t("soul_accounts.rebirth.fields.current_step"), currentStep)}
          {row(t("soul_accounts.rebirth.fields.cross_civilization"), crossText)}
          {row(
            t("soul_accounts.rebirth.fields.appeal"),
            t(a.appeal_workflow ? "soul_accounts.rebirth.appeal.used" : a.can_appeal ? "soul_accounts.rebirth.appeal.available" : "soul_accounts.rebirth.appeal.none")
          )}
          {row(
            t("soul_accounts.rebirth.fields.decided_at"),
            a.decided_at ? <span className="font-mono">{formatDateTime(a.decided_at)}</span> : <MissingValue kind="unrecorded" />
          )}
          {a.cooldown_until &&
            row(
              t("soul_accounts.rebirth.fields.cooldown"),
              <span data-testid="rebirth-cooldown">{t("soul_accounts.rebirth.cooldown_until", { time: formatDateTime(a.cooldown_until) })}</span>
            )}
          {row(t("soul_accounts.rebirth.fields.created_at"), <span className="font-mono">{formatDateTime(a.created_at)}</span>)}
        </dl>

        <section>
          <h3 className="text-01 uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.rebirth.fields.statement")}</h3>
          <p className="text-03 whitespace-pre-wrap break-words">{a.statement || <MissingValue kind="unrecorded" reason={t("soul_accounts.rebirth.statement_empty")} />}</p>
        </section>
        {a.appeal_workflow && (
          <section>
            <h3 className="text-01 uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.rebirth.fields.appeal_statement")}</h3>
            <p className="text-03 whitespace-pre-wrap break-words">
              {a.appeal_statement || <MissingValue kind="unrecorded" reason={t("soul_accounts.rebirth.statement_empty")} />}
            </p>
          </section>
        )}
        {a.rejection_reason && (
          <section>
            <h3 className="text-01 uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.rebirth.fields.rejection_reason")}</h3>
            <p className="text-03 whitespace-pre-wrap break-words">{a.rejection_reason}</p>
          </section>
        )}

        {canDecide && (
          <section className="border-t border-[oklch(var(--color-hairline))] pt-3 space-y-2" data-testid="cross-civilization-decision">
            <h3 className="text-03 font-medium">{t("soul_accounts.rebirth.cross_title")}</h3>
            <p className="text-02 text-[oklch(var(--color-ink-muted))]">{t("soul_accounts.rebirth.cross_hint")}</p>
            <div className="flex flex-wrap gap-2">
              {[false, true].map((value) => (
                <Button
                  key={String(value)}
                  type="button"
                  size="sm"
                  variant={a.cross_civilization === value ? "primary" : "secondary"}
                  aria-pressed={a.cross_civilization === value}
                  loading={decide.isPending && decide.variables?.value === value}
                  disabled={decide.isPending}
                  onClick={() => setCross(value)}
                >
                  {t(value ? "soul_accounts.rebirth.cross.yes" : "soul_accounts.rebirth.cross.no")}
                </Button>
              ))}
            </div>
          </section>
        )}

        <Link href={`/workflow/${a.appeal_workflow ?? a.workflow}`} className="inline-block text-03 underline text-[oklch(var(--color-accent-ink))]">
          {t("soul_accounts.rebirth.open_workflow")}
        </Link>
      </div>
    </BaseModal>
  );
}
