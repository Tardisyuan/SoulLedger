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

// ── Query Keys ───────────────────────────────────────────────────────

export const soulKeys = {
  all: ["souls"] as const,
  list: (params?: Record<string, string>) =>
    [...soulKeys.all, "list", params] as const,
  detail: (id: string) => [...soulKeys.all, "detail", id] as const,
  karma: (id: string) => [...soulKeys.all, "karma", id] as const,
};

// ── Souls ───────────────────────────────────────────────────────────

export function useSouls(params?: Record<string, string>) {
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
  return useMutation({
    mutationFn: (data: object) => soulsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
  });
}

export function useMarkSoulDead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: object }) =>
      soulsApi.die(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: soulKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
  });
}

export function useTransitionSoul() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      soulsApi.transition(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: soulKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
  });
}

export function useAddSoulRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      soulsApi.addRecord(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: soulKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: soulKeys.karma(vars.id) });
    },
  });
}

export function useUpdateSoul() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SoulInput> }) =>
      soulsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast("更新失败", "error");
    },
  });
}

export function useDeleteSoul() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  return useMutation({
    mutationFn: (id: string) => soulsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
    onError: () => {
      showToast("删除失败", "error");
    },
  });
}

// ── Judgment ────────────────────────────────────────────────────────

export function useJudgments(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["judgments", params] as const,
    queryFn: async () => {
      const res = await judgmentApi.list(params);
      return res.data as { results: Judgment[]; count: number };
    },
    staleTime: 30_000,
  });
}

export function useConcludeJudgment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      judgmentApi.conclude(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["judgments"] });
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
  });
}

// ── Disposition ─────────────────────────────────────────────────────

export function useDispositions(params?: Record<string, string>) {
  return useQuery({
    queryKey: ["dispositions", params] as const,
    queryFn: async () => {
      const res = await dispositionApi.list(params);
      return res.data as unknown[];
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
      qc.invalidateQueries({ queryKey: ["dispositions"] });
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
  });
}

// ── Reincarnation ──────────────────────────────────────────────────

export function useReborn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: object) => reincarnationApi.reborn(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: soulKeys.all });
    },
  });
}
