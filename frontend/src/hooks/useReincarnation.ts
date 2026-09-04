"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reincarnationApi } from "@soulledger/core/api";
import { notify } from "@soulledger/core/platform";
import { useI18n } from "@/src/contexts/I18nContext";

export function useReborn() {
  const qc = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (data: object) => reincarnationApi.reborn(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["souls"] });
      notify(t("reincarnation.reborn_success") || "Reborn successfully", "success");
    },
    onError: () => {
      notify(t("reincarnation.reborn_error") || "Rebirth failed", "error");
    },
  });
}
