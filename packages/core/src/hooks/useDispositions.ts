"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dispositionApi } from "../api/index";
import { notify } from "../platform/index";
import { dispositionKeys } from "../query_keys";

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
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: object }) =>
      dispositionApi.execute(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dispositionKeys.all });
      notify("disposition.execute_success", "success");
    },
    onError: () => {
      notify("disposition.execute_error", "error");
    },
  });
}
