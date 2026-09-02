"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { soulsApi, type SoulInput } from "@soulledger/core/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { soulKeys } from "@soulledger/core/query_keys";

// ── Souls ───────────────────────────────────────────────────────────

export function useSouls(params?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: soulKeys.list(params),
    queryFn: async () => {
      const res = await soulsApi.list(params);
      return res.data;
    },
    // Keep the previous page rendered while the next one loads, so a page
    // turn or a filter change does not flash a skeleton over data that is
    // about to be replaced by more of the same. `useJudgmentQueue` was the
    // only list in the app doing this; every other one blanked.
    placeholderData: (previous) => previous,
    staleTime: 30_000, // 30s — reduce redundant API calls
  });
}

export function useSoul(id: string) {
  return useQuery({
    queryKey: soulKeys.detail(id),
    queryFn: async () => {
      const res = await soulsApi.get(id);
      return res.data;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useSoulLedger(id: string) {
  return useQuery({
    queryKey: soulKeys.ledger(id),
    queryFn: async () => {
      const res = await soulsApi.karma(id);
      return res.data;
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
      showToast(t("souls.form.create_success") || "Soul created", "success");
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
      qc.invalidateQueries({ queryKey: soulKeys.ledger(vars.id) });
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
      showToast(t("souls.form.update_success") || "Soul updated", "success");
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
      // The delete is soft — the record is in /recycle-bin — and this said
      // nothing at all, so the safety net existed and was undiscoverable.
      // The wording names what the backend did, the way the menus delete
      // confirmation already does ("移至回收站", never "删除").
      showToast(t("souls.detail.delete_to_recycle_bin"), "success");
    },
    onError: () => {
      showToast(t("souls.detail.error_delete"), "error");
    },
  });
}

// NOTE: Judgment hooks (useJudgments, useConcludeJudgment) are in useJudgments.ts
// NOTE: Disposition hooks (useDispositions, useExecuteDisposition) are in useDispositions.ts
// NOTE: Reincarnation hooks (useReborn) are in useReincarnation.ts
