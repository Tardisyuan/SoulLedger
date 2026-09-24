"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "../api/index";
import type { JudgmentBatchPayload, JudgmentQueueCountsParams } from "../api/index";
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

/**
 * The four queue groups' sizes (`GET /judgment/queue-counts/`). Pass the same
 * `court` / `search` the list is filtered by, so the tab badges agree with it.
 */
export function useJudgmentQueueCounts(params?: JudgmentQueueCountsParams) {
  return useQuery({
    queryKey: judgmentKeys.queueCounts(params),
    queryFn: async () => {
      const res = await judgmentApi.queueCounts(params);
      return res.data;
    },
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

// ── Claim / release / reassign / defer (apps/judgment/claims.py) ─────
//
// No toast here, unlike the two above. A refusal is a 409/403 whose `code`
// (`already_claimed`, `not_claimant`, …; see `JudgmentClaimRefusal`) the queue
// screen has to branch on — "someone else took it" wants a different response
// from "you may not" — and a generic error toast fired from the hook would
// land on top of whatever the screen says. Callers read `error` / `onError`.
//
// Every one invalidates `judgmentKeys.all`: a claim moves a case between
// groups, so the list pages, the counts and the queue cursor are all stale.

function useClaimMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: judgmentKeys.all });
    },
  });
}

export function useClaimJudgment() {
  return useClaimMutation((id: string) => judgmentApi.claim(id));
}

export function useReleaseJudgment() {
  return useClaimMutation((id: string) => judgmentApi.release(id));
}

/** Needs `judgment.assign` (ADMIN, MODERATOR). */
export function useReassignJudgment() {
  return useClaimMutation(({ id, to }: { id: string; to: number }) => judgmentApi.reassign(id, to));
}

export function useDeferJudgment() {
  return useClaimMutation(({ id, reason }: { id: string; reason: string }) => judgmentApi.defer(id, reason));
}

export function useUndeferJudgment() {
  return useClaimMutation((id: string) => judgmentApi.undefer(id));
}

/** Up to 100 ids, all or nothing: a refusal names the case that rolled it back. */
export function useBatchJudgments() {
  return useClaimMutation((payload: JudgmentBatchPayload) => judgmentApi.batch(payload));
}
