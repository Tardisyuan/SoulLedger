"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { responseCode } from "@soulledger/core/api/client";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";

const REFUSALS = [
  "not_withdrawable", "not_your_seal", "no_pending_flow", "cross_judgment_merged", "approval_started", "cannot_withdraw",
] as const;

/**
 * 「撤回落印」(2026-11-14):原审落印后、第一位审批人动手之前,落印的判官收回这一印
 * (`POST /judgment/{id}/withdraw-conclusion/`)。审批流程取消、发落作废,另开一件由他认领的新案,成功后去新案。
 * 调用方只在 `can_withdraw` 时画它;先确认再发。拒绝码走译文,别的码一句通用错误。
 */
export function WithdrawConclusionButton({ judgmentId }: { judgmentId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const withdraw = useMutation({
    mutationFn: async () => (await judgmentApi.withdrawConclusion(judgmentId)).data,
    onSuccess: (retrial) => {
      void queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
      void queryClient.invalidateQueries({ queryKey: soulKeys.all });
      showToast(t("judgment.withdraw_conclusion.done", { case_number: retrial.case_number }), "success");
      router.push(`/judgment/${retrial.id}`);
    },
    onError: (error) => {
      const code = responseCode(error);
      showToast(
        code && (REFUSALS as readonly string[]).includes(code)
          ? t(`judgment.withdraw_conclusion.refusal.${code}`)
          : t("common.error"),
        "error",
      );
    },
    onSettled: () => setAsking(false),
  });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid="withdraw-conclusion"
        title={t("judgment.withdraw_conclusion.hint")}
        loading={withdraw.isPending}
        disabled={withdraw.isPending}
        onClick={() => setAsking(true)}
      >
        {t("judgment.withdraw_conclusion.button")}
      </Button>
      <ConfirmDialog
        isOpen={asking}
        title={t("judgment.withdraw_conclusion.button")}
        message={t("judgment.withdraw_conclusion.confirm")}
        confirmText={t("judgment.withdraw_conclusion.button")}
        confirmLoading={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
