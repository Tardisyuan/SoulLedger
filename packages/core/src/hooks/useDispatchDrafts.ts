"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dispatchApi, type DispatchDraftInput } from "../api/index";
import { dispatchKeys, recycleBinKeys } from "../query_keys";

/**
 * Dispatch drafts and the target-realm picker (设计稿「发起移交」: 存草稿 /
 * 目标界域 / 放弃…). No toasts here: the propose form maps field-keyed 400s onto
 * its own controls, which a hook-level notice would only duplicate.
 */

export function useDispatchRecord(id: string) {
  return useQuery({
    queryKey: dispatchKeys.detail(id),
    queryFn: async () => (await dispatchApi.get(id)).data,
    enabled: !!id,
  });
}

/** Realms of the chosen target civilization; idle until one is chosen. */
export function useDispatchRealmOptions(targetTenantCode: string) {
  return useQuery({
    queryKey: dispatchKeys.realmOptions(targetTenantCode),
    queryFn: async () => (await dispatchApi.realmOptions(targetTenantCode)).data,
    enabled: !!targetTenantCode,
    // Realms are seeded reference data; they do not move under an open form.
    staleTime: 5 * 60_000,
  });
}

/** Save a draft: creates one when `id` is absent, otherwise updates it. */
export function useSaveDispatchDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: DispatchDraftInput }) =>
      (await (id ? dispatchApi.updateDraft(id, data) : dispatchApi.createDraft(data))).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: dispatchKeys.all }),
  });
}

export function useSubmitDispatchDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: DispatchDraftInput }) =>
      (await dispatchApi.submitDraft(id, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: dispatchKeys.all }),
  });
}

/** Discard = soft delete into the recycle bin, so the bin's list is stale too. */
export function useDiscardDispatchDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dispatchApi.discardDraft(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dispatchKeys.all });
      qc.invalidateQueries({ queryKey: recycleBinKeys.all });
    },
  });
}
