"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { responseCode } from "@soulledger/core/api/client";

const REFUSALS = ["not_cancelled", "cannot_reopen"] as const;

/**
 * 「重开一案」(fix-be1 遗留·网页):原审的审批流被联审撤销(CANCELLED),发落卡在 approval_cancelled —— 流程没通过所以不执行,
 * 也没人驳回所以不重审。持 judgment.assign 的殿主撤回结案、开一件新案(`POST /judgment/{id}/reopen-cancelled/`),
 * 成功后去新案。调用方只在 `flow_cancelled` 且持码时画它;拒绝码走译文,别的码一句通用错误。
 */
export function ReopenCancelledButton({ judgmentId }: { judgmentId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const reopen = useMutation({
    mutationFn: async () => (await judgmentApi.reopenCancelled(judgmentId)).data,
    onSuccess: (retrial) => {
      void queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
      void queryClient.invalidateQueries({ queryKey: soulKeys.all });
      showToast(t("judgment.reopen_cancelled.done", { case_number: retrial.case_number }), "success");
      router.push(`/judgment/${retrial.id}`);
    },
    onError: (error) => {
      const code = responseCode(error);
      showToast(
        code && (REFUSALS as readonly string[]).includes(code) ? t(`judgment.reopen_cancelled.refusal.${code}`) : t("common.error"),
        "error",
      );
    },
  });
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      data-testid="reopen-cancelled"
      title={t("judgment.reopen_cancelled.hint")}
      loading={reopen.isPending}
      disabled={reopen.isPending}
      onClick={() => reopen.mutate()}
    >
      {t("judgment.reopen_cancelled.button")}
    </Button>
  );
}
