"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "../api/index";
import type { EvidenceRulingPayload, JudgmentDetail, JudgmentDraftPayload } from "../api/judgment";
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

/**
 * Rule one ledger record admitted / not admitted in a judgment. Refetches the
 * detail, which carries the rulings and the admitted balance. No toast: the
 * desk shows the ruling in place, and a 409 (`concluded`) or 400 (missing
 * reason) is the caller's to explain.
 */
export function useRuleEvidence(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ recordId, data }: { recordId: string; data: EvidenceRulingPayload }) =>
      judgmentApi.ruleEvidence(id, recordId, data).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.detail(id) });
    },
  });
}

/**
 * Autosave the verdict draft. Writes the saved draft into the cached detail
 * instead of refetching, so the next save sends the new `draft_version` and
 * the page's `notesTouched` guard is the only thing deciding whether the
 * textarea follows. No toast either way: an autosave that toasts on every
 * keystroke pause is noise, and a 409 `draft_conflict` needs the caller to
 * show `current` rather than a generic error.
 */
export function useSaveJudgmentDraft(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: JudgmentDraftPayload) => judgmentApi.saveDraft(id, data).then((res) => res.data),
    onSuccess: (draft) => {
      qc.setQueryData<JudgmentDetail>(judgmentKeys.detail(id), (old) => (old ? { ...old, ...draft } : old));
    },
  });
}
