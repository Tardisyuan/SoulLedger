"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reincarnationApi } from "../api/index";
import { notify } from "../platform/index";

export function useReborn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: object) => reincarnationApi.reborn(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["souls"] });
      notify("reincarnation.reborn_success", "success");
    },
    onError: () => {
      notify("reincarnation.reborn_error", "error");
    },
  });
}
