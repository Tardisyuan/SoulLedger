"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dispositionApi, type Disposition } from "@/lib/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { dispositionKeys } from "@/lib/query_keys";

export function useDispositions(params?: Record<string, string>) {
  return useQuery({
    queryKey: dispositionKeys.list(params),
    queryFn: async () => {
      const res = await dispositionApi.list(params);
      return res.data as Disposition[];
    },
    staleTime: 30_000,
  });
}

export function useExecuteDisposition() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: object }) =>
      dispositionApi.execute(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dispositionKeys.all });
      showToast(t("disposition.execute_success") || "Disposition executed", "success");
    },
    onError: () => {
      showToast(t("disposition.execute_error") || "Failed to execute disposition", "error");
    },
  });
}
