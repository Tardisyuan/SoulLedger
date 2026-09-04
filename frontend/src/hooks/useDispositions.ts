"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dispositionApi } from "@soulledger/core/api";
import { notify } from "@soulledger/core/platform";
import { useI18n } from "@/src/contexts/I18nContext";
import { dispositionKeys } from "@soulledger/core/query_keys";

export function useDispositions(params?: Record<string, string>) {
  return useQuery({
    queryKey: dispositionKeys.list(params),
    queryFn: async () => {
      const res = await dispositionApi.list(params);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useExecuteDisposition() {
  const qc = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: object }) =>
      dispositionApi.execute(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dispositionKeys.all });
      notify(t("disposition.execute_success") || "Disposition executed", "success");
    },
    onError: () => {
      notify(t("disposition.execute_error") || "Failed to execute disposition", "error");
    },
  });
}
