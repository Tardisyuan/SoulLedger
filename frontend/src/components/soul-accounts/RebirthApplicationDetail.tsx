"use client";

import Link from "next/link";
import type { OfficerRebirthApplication } from "@soulledger/core/api";
import { classifySoulAccountError, useDecideCrossCivilization } from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { failureKey, lifeNumber, rebirthBadgeClass } from "./soulAccountsView";
import { SoulCode } from "@/src/components/soul-accounts/SoulCode";
import { tenantLabel } from "@/src/lib/domainNames";

interface Props {
  application: OfficerRebirthApplication;
  onClose: () => void;
}

export function RebirthApplicationDetail({ application: a, onClose }: Props) {
  const { t, formatDateTime, locale } = useI18n();
  const { showToast } = useToast();
  const decide = useDecideCrossCivilization();
  /* The backend's answer, not a local reconstruction. It is computed by the same
   * function the `cross-civilization/` endpoint runs (`rebirth.cross_civilization_refusal`),
   * so the control cannot be offered where the write would be refused. This used to
   * rebuild the rule here from `current_step.node_type === "EVALUATION"` plus the role —
   * a second copy that nothing kept in step with the first. */
  const canDecide = a.can_decide_cross_civilization;
  const step = a.current_step;

  // F-REB-11: crossing names the hall the soul is reborn into; the choices are the backend's
  // (`cross_civilization_targets`: rebirth-capable, not the soul's own civilization), never a local list.
  const targets = a.cross_civilization_targets ?? [];
  const hallName = (hall: { code: string; display_name: string }) => tenantLabel(t, hall, locale);
  const setCross = (value: boolean, target?: string) =>
    decide.mutate(
      { id: a.id, value, target },
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
      : a.cross_civilization && a.target_hall
        ? t("soul_accounts.rebirth.cross_to", { hall: hallName(a.target_hall) })
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {row(t("soul_accounts.fields.soul_code"), <SoulCode code={a.soul_code} />)}
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
          <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.rebirth.fields.statement")}</h3>
          <p className="text-sm whitespace-pre-wrap break-words">{a.statement || <MissingValue kind="unrecorded" reason={t("soul_accounts.rebirth.statement_empty")} />}</p>
        </section>
        {a.appeal_workflow && (
          <section>
            <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.rebirth.fields.appeal_statement")}</h3>
            <p className="text-sm whitespace-pre-wrap break-words">
              {a.appeal_statement || <MissingValue kind="unrecorded" reason={t("soul_accounts.rebirth.statement_empty")} />}
            </p>
          </section>
        )}
        {a.rejection_reason && (
          <section>
            <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.rebirth.fields.rejection_reason")}</h3>
            <p className="text-sm whitespace-pre-wrap break-words">{a.rejection_reason}</p>
          </section>
        )}

        {canDecide && (
          <section className="border-t border-[oklch(var(--color-line))] pt-3 space-y-2" data-testid="cross-civilization-decision">
            <h3 className="text-sm font-medium">{t("soul_accounts.rebirth.cross_title")}</h3>
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("soul_accounts.rebirth.cross_hint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={a.cross_civilization === false ? "primary" : "secondary"}
                aria-pressed={a.cross_civilization === false}
                loading={decide.isPending && decide.variables?.value === false}
                disabled={decide.isPending}
                onClick={() => setCross(false)}
              >
                {t("soul_accounts.rebirth.cross.no")}
              </Button>
              {targets.map((hall) => {
                const chosen = a.cross_civilization === true && a.target_hall?.code === hall.code;
                return (
                  <Button
                    key={hall.code}
                    type="button"
                    size="sm"
                    data-testid={`cross-target-${hall.code}`}
                    variant={chosen ? "primary" : "secondary"}
                    aria-pressed={chosen}
                    loading={decide.isPending && decide.variables?.value === true && decide.variables?.target === hall.code}
                    disabled={decide.isPending}
                    onClick={() => setCross(true, hall.code)}
                  >
                    {t("soul_accounts.rebirth.cross_to", { hall: hallName(hall) })}
                  </Button>
                );
              })}
            </div>
            {targets.length === 0 && (
              <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("soul_accounts.rebirth.cross_no_targets")}</p>
            )}
          </section>
        )}

        <Link href={`/workflow/${a.appeal_workflow ?? a.workflow}`} className="inline-block text-sm underline text-[oklch(var(--color-accent-ink))]">
          {t("soul_accounts.rebirth.open_workflow")}
        </Link>
      </div>
    </BaseModal>
  );
}
