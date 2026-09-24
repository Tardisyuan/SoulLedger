"use client";

import { useState } from "react";
import type { SentencePlan, SentencePlanRequest } from "@soulledger/core/api/sentence-plans";
import { useDecideSentenceRequest, useWithdrawSentenceRequest } from "@soulledger/core/hooks/useSentencePlans";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { TextAreaField } from "@/src/components/ui/Field";
import { refusalKey } from "./sentencePlanDisplay";

/**
 * 一条 PENDING 请求上的按钮。
 *
 * * 批准 / 驳回:只有原属租户(计划的 `tenant_code`)或 ADMIN —— 原审判官决定(Q2);
 * * 撤回:只有提出方(`from_tenant_code`)或 ADMIN(§4.2);
 * * 三个都要 `judgment.execute`(视图的 `extra_permissions`)。
 *
 * 看不到按钮的人点了也只会 403,所以按钮只给能成功的人;服务端照样再判一次。
 */
export function SentenceRequestActions({ plan, request }: { plan: SentencePlan; request: SentencePlanRequest }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const decide = useDecideSentenceRequest();
  const withdraw = useWithdrawSentenceRequest();
  const [decision, setDecision] = useState<"ACCEPT" | "REJECT" | null>(null);
  const [reason, setReason] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const mine = user?.tenant?.code ?? null;
  const canAct = request.status === "PENDING" && hasPermission("judgment.execute");
  const canDecide = canAct && (isAdmin || (mine !== null && mine === plan.tenant_code));
  const canWithdraw = canAct && (isAdmin || (mine !== null && mine === request.from_tenant_code));
  if (!canDecide && !canWithdraw) return null;

  const closeDecision = () => {
    setDecision(null);
    setReason("");
  };
  const submitDecision = () => {
    if (!decision) return;
    decide.mutate(
      { planId: plan.id, requestId: request.id, decision, reason: reason.trim() },
      {
        onSuccess: () => {
          closeDecision();
          showToast(t(decision === "ACCEPT" ? "sentence_plan.accepted" : "sentence_plan.rejected"), "success");
        },
        // 对话框不关:理由还在里面,409 open_judgment 之后多半要等那件审判结案再来。
        onError: (error) => showToast(t(refusalKey(error)), "error"),
      }
    );
  };
  const submitWithdraw = () =>
    withdraw.mutate(
      { planId: plan.id, requestId: request.id },
      {
        onSuccess: () => {
          setConfirmWithdraw(false);
          showToast(t("sentence_plan.withdrawn"), "success");
        },
        onError: (error) => {
          setConfirmWithdraw(false);
          showToast(t(refusalKey(error)), "error");
        },
      }
    );

  return (
    <div className="flex flex-wrap gap-2">
      {canDecide && (
        <>
          <Button type="button" size="sm" variant="primary" onClick={() => setDecision("ACCEPT")}>
            {t("sentence_plan.accept")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setDecision("REJECT")}>
            {t("sentence_plan.reject")}
          </Button>
        </>
      )}
      {canWithdraw && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmWithdraw(true)}>
          {t("sentence_plan.withdraw")}
        </Button>
      )}

      <BaseModal
        isOpen={decision !== null}
        onClose={closeDecision}
        title={t(decision === "REJECT" ? "sentence_plan.reject_title" : "sentence_plan.accept_title", { soul: plan.soul_name })}
        footer={
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={closeDecision}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant={decision === "REJECT" ? "danger" : "primary"}
              loading={decide.isPending}
              onClick={submitDecision}
            >
              {t(decision === "REJECT" ? "sentence_plan.reject" : "sentence_plan.accept")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink-muted))] mb-3">
          {t(
            decision === "REJECT"
              ? "sentence_plan.reject_warning"
              : request.kind === "REOPEN"
                ? "sentence_plan.accept_reopen_warning"
                : "sentence_plan.accept_warning"
          )}
        </p>
        <TextAreaField
          label={t("sentence_plan.decision_reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </BaseModal>

      <ConfirmDialog
        isOpen={confirmWithdraw}
        title={t("sentence_plan.withdraw_title")}
        message={t("sentence_plan.withdraw_warning")}
        confirmText={t("sentence_plan.withdraw")}
        onConfirm={submitWithdraw}
        onCancel={() => setConfirmWithdraw(false)}
        confirmLoading={withdraw.isPending}
        variant="warning"
      />
    </div>
  );
}
