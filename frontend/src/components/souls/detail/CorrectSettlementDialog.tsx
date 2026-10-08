"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { soulsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";

/** 后端 400 的 `{error}` 原样;别的形状交给调用方的通用文案。 */
export function correctSettlementError(error: unknown): string | null {
  const r = (error as { response?: { status?: number; data?: { error?: unknown } } })?.response;
  return r?.status === 400 && typeof r.data?.error === "string" ? r.data.error : null;
}

/**
 * ADMIN 更正结案:SETTLED → DISPOSED(`POST /souls/{id}/correct_settlement/`)。
 * 原因必填 —— 后端也拒绝空原因,这里只是不让空提交出门;后端的 400 原样显示在字段下。
 * 成功后由调用方重取灵魂(`onCorrected`),这里不碰缓存。
 */
export function CorrectSettlementDialog({
  soulId,
  isOpen,
  onClose,
  onCorrected,
}: {
  soulId: string;
  isOpen: boolean;
  onClose: () => void;
  onCorrected: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const correct = useMutation({
    mutationFn: () => soulsApi.correctSettlement(soulId, reason.trim()).then((r) => r.data),
    onSuccess: () => {
      showToast(t("souls.detail.correct_settlement.success"), "success");
      setReason("");
      onCorrected();
      onClose();
    },
    onError: (e) => {
      const message = correctSettlementError(e);
      if (message) setError(message);
      else showToast(t("souls.detail.correct_settlement.failed"), "error");
    },
  });

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !correct.isPending && onClose()}
      title={t("souls.detail.correct_settlement.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={correct.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="correct-settlement-form" variant="warning" loading={correct.isPending}>
            {t("souls.detail.correct_settlement.confirm")}
          </Button>
        </div>
      }
    >
      <form
        id="correct-settlement-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) {
            setError(t("souls.detail.correct_settlement.reason_required"));
            return;
          }
          setError(null);
          correct.mutate();
        }}
      >
        <p className="text-sm text-[oklch(var(--color-ink))]">{t("souls.detail.correct_settlement.message")}</p>
        <TextAreaField
          label={t("souls.detail.correct_settlement.reason")}
          required
          rows={3}
          error={error}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          disabled={correct.isPending}
        />
      </form>
    </BaseModal>
  );
}
