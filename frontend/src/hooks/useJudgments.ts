"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, type Judgment } from "@/lib/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { judgmentKeys } from "@/lib/query_keys";

// ── Queries ──────────────────────────────────────────────────────────

export function useJudgments(params?: Record<string, string>) {
  return useQuery({
    queryKey: judgmentKeys.list(params),
    queryFn: async () => {
      const res = await judgmentApi.list(params);
      return res.data as { results: Judgment[]; count: number };
    },
    staleTime: 30_000,
  });
}

export function useJudgment(id: string) {
  return useQuery({
    queryKey: judgmentKeys.detail(id),
    queryFn: async () => {
      const res = await judgmentApi.get(id);
      return res.data as Judgment;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useCreateJudgment() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (data: object) => judgmentApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
      showToast(t("judgment.create_success") || "Judgment created", "success");
    },
    onError: () => {
      showToast(t("judgment.create_error") || "Failed to create judgment", "error");
    },
  });
}

export function useConcludeJudgment() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      judgmentApi.conclude(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
      showToast(t("judgment.conclude_success") || "Judgment concluded", "success");
    },
    onError: () => {
      showToast(t("judgment.conclude_error") || "Failed to conclude judgment", "error");
    },
  });
}
