"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "../api/index";
import { notify } from "../platform/index";
import { judgmentKeys } from "../query_keys";

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

/** 「据 · 先例」 for one judgment — see `judgmentApi.precedents`. */
export function useJudgmentPrecedents(id: string, limit?: number) {
  return useQuery({
    queryKey: judgmentKeys.precedents(id, limit),
    queryFn: async () => {
      const res = await judgmentApi.precedents(id, limit);
      return res.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useCreateJudgment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: object) => judgmentApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
      notify("judgment.create_success", "success");
    },
    onError: () => {
      notify("judgment.create_error", "error");
    },
  });
}

export function useConcludeJudgment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      judgmentApi.conclude(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
      notify("judgment.conclude_success", "success");
    },
    onError: () => {
      notify("judgment.conclude_error", "error");
    },
  });
}
