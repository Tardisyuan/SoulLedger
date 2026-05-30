"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  soulsApi,
  judgmentApi,
  dispositionApi,
  reincarnationApi,
  type Soul,
  type SoulInput,
  type Judgment,
  type KarmaSummary,
} from "@/lib/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { soulKeys } from "@/lib/query_keys";

// ── Souls ───────────────────────────────────────────────────────────

export function useSouls(params?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: soulKeys.list(params),
    queryFn: async () => {
      const res = await soulsApi.list(params);
      return res.data as { results: Soul[]; count: number };
    },
    staleTime: 30_000, // 30s — reduce redundant API calls
  });
}

export function useSoul(id: string) {
  return useQuery({
    queryKey: soulKeys.detail(id),
    queryFn: async () => {
      const res = await soulsApi.get(id);
      return res.data as Soul;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useSoulKarma(id: string) {
  return useQuery({
    queryKey: soulKeys.karma(id),
    queryFn: async () => {
      const res = await soulsApi.karma(id);
      return res.data as KarmaSummary;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ── Mutations ───────────────────────────────────────────────────────

export function useCreateSoul() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (data: object) => soulsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast(t("souls.form.create_error") || "Failed to create soul", "error");
    },
  });
}

export function useMarkSoulDead() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: object }) =>
      soulsApi.die(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: soulKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast(t("souls.detail.failed") || "Operation failed", "error");
    },
  });
}

export function useTransitionSoul() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      soulsApi.transition(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: soulKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast(t("souls.detail.failed") || "Operation failed", "error");
    },
  });
}

export function useAddSoulRecord() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      soulsApi.addRecord(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: soulKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: soulKeys.karma(vars.id) });
    },
    onError: () => {
      showToast(t("souls.detail.failed") || "Operation failed", "error");
    },
  });
}

export function useUpdateSoul() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SoulInput> }) =>
      soulsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast(t("souls.detail.error_update"), "error");
    },
  });
}

export function useDeleteSoul() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (id: string) => soulsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast(t("souls.detail.error_delete"), "error");
    },
  });
}

// NOTE: Judgment hooks (useJudgments, useConcludeJudgment) are in useJudgments.ts
// NOTE: Disposition hooks (useDispositions, useExecuteDisposition) are in useDispositions.ts
// NOTE: Reincarnation hooks (useReborn) are in useReincarnation.ts
