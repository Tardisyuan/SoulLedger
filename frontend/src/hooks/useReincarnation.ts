"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reincarnationApi } from "@/lib/api";
import { showToast } from "@/src/components/ui/Toast";
import { useI18n } from "@/src/contexts/I18nContext";

export function useReborn() {
  const qc = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (data: object) => reincarnationApi.reborn(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["souls"] });
      showToast(t("reincarnation.reborn_success") || "Reborn successfully", "success");
    },
    onError: () => {
      showToast(t("reincarnation.reborn_error") || "Rebirth failed", "error");
    },
  });
}
