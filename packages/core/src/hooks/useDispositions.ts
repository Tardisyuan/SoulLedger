"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dispositionApi, type DispositionListParams } from "../api/index";
import { notify } from "../platform/index";
import { dispositionKeys } from "../query_keys";

/**
 * One page of dispositions. Pass `section` for one of the three sections; the
 * response's `section_counts` are the totals of all three under the same
 * filters, so a section tab can show its real count while another is open.
 */
export function useDispositions(params?: DispositionListParams) {
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
