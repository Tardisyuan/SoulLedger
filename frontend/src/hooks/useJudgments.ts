"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { notify } from "@soulledger/core/platform";
import { useI18n } from "@/src/contexts/I18nContext";
import { judgmentKeys } from "@soulledger/core/query_keys";

// ── Queries ──────────────────────────────────────────────────────────

export function useJudgments(params?: Record<string, string>) {
  return useQuery({
    queryKey: judgmentKeys.list(params),
    queryFn: async () => {
      const res = await judgmentApi.list(params);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useJudgment(id: string) {
  return useQuery({
    queryKey: judgmentKeys.detail(id),
    queryFn: async () => {
      const res = await judgmentApi.get(id);
      return res.data;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useCreateJudgment() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: (data: object) => judgmentApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
      notify(t("judgment.create_success") || "Judgment created", "success");
    },
    onError: () => {
      notify(t("judgment.create_error") || "Failed to create judgment", "error");
    },
  });
}

export function useConcludeJudgment() {
  const qc = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      judgmentApi.conclude(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
      notify(t("judgment.conclude_success") || "Judgment concluded", "success");
    },
    onError: () => {
      notify(t("judgment.conclude_error") || "Failed to conclude judgment", "error");
    },
  });
}
