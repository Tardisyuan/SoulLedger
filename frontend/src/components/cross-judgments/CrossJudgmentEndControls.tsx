"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, type CrossTenantJudgment } from "@soulledger/core/api";
import { segmentRealm } from "@soulledger/core/domain/workflowSegments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { BaseModal } from "@/src/components/ui/Modal";
import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";

/** 结束说明的上限,与 `CrossTenantJudgmentConcludeSerializer.note` 的 max_length 同一个数。 */
export const END_NOTE_MAX = 1000;

/**
 * 跨域审判页头的「结束」主按钮与 ⋯ 里的「取消」(第四十批 W-a)。
 *
 * 只给能做的人:`can_end` 由服务端按「召集人或发起殿的管理员,且还在进行」算好,这里不再抄一遍规则。
 * 不能做就什么都不渲染 —— 已结束 / 已取消后页头写结果(见详情页),不留入口。
 * 挂着的审批流程还在走时不给「结束」(2026-10-18 用户决定:流程走完 / 被驳回时它自己结束),换成一行说明;取消照旧。
 * 不在服务端把 `can_end` 置 false:取消也看它。409 `workflow_running` 的提示留作兜底(页面数据陈旧时)。
 * 结论两选一、没有默认值;说明与理由都必填,空着按钮不可点。
 */
export function CrossJudgmentEndControls({ judgment }: { judgment: CrossTenantJudgment }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [ending, setEnding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [conclusion, setConclusion] = useState<"PASS" | "FAIL" | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const done = () => queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
  const end = useMutation({
    mutationFn: () => crossTenantJudgmentsApi.conclude(judgment.id, { conclusion_type: conclusion!, note: note.trim() }),
    onSuccess: () => {
      setEnding(false);
      done();
    },
    onError: (error) => {
      // 第四十三批:并入了审批流程的跨域审判由流程结束(走完 = 通过,驳回 = 不通过);流程还在走时手动结束答 409。
      const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
      showToast(t(code === "workflow_running" ? "crossJudgments.workflow_running" : "crossJudgments.end_error"), "error");
    },
  });
  const cancel = useMutation({
    mutationFn: () => crossTenantJudgmentsApi.cancel(judgment.id, reason.trim()),
    onSuccess: () => {
      setCancelling(false);
      done();
    },
    onError: () => showToast(t("crossJudgments.cancel_error"), "error"),
  });

  if (!judgment.can_end) return null;

  /* 取消的正文(第四十三批 W-4b):审批流程还在走时,说清楚外域段会怎样。流程已经走进某个外域段时,那一段的当前站
     与之后的站(含它的终审)一并跳过、流程随即结束;否则还没走的外域段全部跳过、流程走完本域后结束。 */
  const flow = judgment.workflow ?? null;
  const flowRunning = !!flow && (flow.status === "IN_PROGRESS" || flow.status === "PENDING");
  const inForeign = flowRunning && flow.at && flow.at.segment > 1 ? flow.at : null;
  const unstarted = flowRunning
    ? flow.segments.filter((s) => s.order > 1 && (s.state === "AWAITING_PICK" || s.state === "PICKED")).map((s) => segmentRealm(t, s))
    : [];
  const cancelBody = inForeign
    ? t("crossJudgments.cancel_flow_body_in_realm", { realm: segmentRealm(t, flow?.segments.find((s) => s.order === inForeign.segment) ?? { tenant_code: "", realm_name: inForeign.realm_name }) })
    : unstarted.length > 0
      ? t("crossJudgments.cancel_flow_body", { realms: unstarted.join("、") })
      : t("crossJudgments.cancel_body");
  const withdrawsPicks = flowRunning && flow.segments.some((s) => s.state === "AWAITING_PICK");

  return (
    <>
      {flowRunning ? (
        <p data-testid="cross-end-flow-running" className="max-w-xs text-xs text-[oklch(var(--color-ink-muted))]">
          {t("crossJudgments.workflow_running")}
        </p>
      ) : (
        <Button size="sm" onClick={() => setEnding(true)} data-testid="cross-end">
          {t("crossJudgments.end")}
        </Button>
      )}
      <ActionsMenu
        menuLabel={t("common.row_actions")}
        items={[{ key: "cancel", label: t("crossJudgments.cancel"), tone: "danger", onSelect: () => setCancelling(true) }]}
      />

      <BaseModal
        isOpen={ending}
        onClose={() => setEnding(false)}
        title={t("crossJudgments.end")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEnding(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => end.mutate()}
              loading={end.isPending}
              disabled={!conclusion || !note.trim()}
            >
              {t("crossJudgments.end")}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-[oklch(var(--color-ink-muted))]">{judgment.title}</p>
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm text-[oklch(var(--color-ink))]">{t("crossJudgments.end_conclusion")}</legend>
          <div className="flex gap-4">
            {(["PASS", "FAIL"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink))]">
                <input
                  type="radio"
                  name={`cross-end-${judgment.id}`}
                  value={value}
                  checked={conclusion === value}
                  onChange={() => setConclusion(value)}
                />
                {t(value === "PASS" ? "crossJudgments.end_pass" : "crossJudgments.end_fail")}
              </label>
            ))}
          </div>
        </fieldset>
        <TextAreaField
          label={t("crossJudgments.end_note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={END_NOTE_MAX}
          rows={4}
          required
          description={`${note.length}/${END_NOTE_MAX}`}
        />
        <p className="mt-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("crossJudgments.end_body")}</p>
      </BaseModal>

      <BaseModal
        isOpen={cancelling}
        onClose={() => setCancelling(false)}
        title={t("crossJudgments.cancel_title")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)}>
              {t("crossJudgments.cancel_keep")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => cancel.mutate()}
              loading={cancel.isPending}
              disabled={!reason.trim()}
              data-testid="cross-cancel-confirm"
            >
              {t("crossJudgments.cancel")}
            </Button>
          </div>
        }
      >
        <p data-testid="cross-cancel-body" className="mb-3 text-sm text-[oklch(var(--color-ink-muted))]">{cancelBody}</p>
        {withdrawsPicks && <p className="mb-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("crossJudgments.cancel_flow_note")}</p>}
        <TextAreaField
          label={t("crossJudgments.cancel_reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={END_NOTE_MAX}
          rows={3}
          required
        />
      </BaseModal>
    </>
  );
}
