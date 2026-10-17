"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, type CrossTenantJudgment } from "@soulledger/core/api";
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
    onError: () => showToast(t("crossJudgments.end_error"), "error"),
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

  return (
    <>
      <Button size="sm" onClick={() => setEnding(true)} data-testid="cross-end">
        {t("crossJudgments.end")}
      </Button>
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
              variant="danger"
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
        <p className="mb-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("crossJudgments.cancel_body")}</p>
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
