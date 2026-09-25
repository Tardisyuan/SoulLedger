"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "../api/index";
import type { EvidenceRulingPayload, JudgmentDetail, JudgmentDraftPayload, JudgmentVerdict } from "../api/judgment";
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

/** 「戊 · 发落」's options for one candidate verdict — see `judgmentApi.destinations`. */
export function useJudgmentDestinations(id: string, verdict: JudgmentVerdict | null | undefined) {
  return useQuery({
    queryKey: judgmentKeys.destinations(id, verdict ?? ""),
    queryFn: async () => {
      const res = await judgmentApi.destinations(id, verdict as JudgmentVerdict);
      return res.data;
    },
    enabled: !!id && !!verdict,
    staleTime: 10_000,
  });
}

/** 「上一件」: the pending case just before `at` (`judgment` is null when there is none). */
export function useJudgmentPrevious(at: string | null | undefined, skip: string[] = []) {
  return useQuery({
    queryKey: judgmentKeys.previous(at ?? "", skip),
    queryFn: async () => {
      const res = await judgmentApi.previous({ at: at as string, skip });
      return res.data;
    },
    enabled: !!at,
  });
}

/** 「下一件」: the pending case just after `after` (`judgment` is null when there is none). */
export function useJudgmentNextAfter(after: string | null | undefined, skip: string[] = []) {
  return useQuery({
    queryKey: judgmentKeys.after(after ?? "", skip),
    queryFn: async () => {
      const res = await judgmentApi.next({ after: after as string, skip });
      return res.data;
    },
    enabled: !!after,
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

/** The queue's court (殿) filter options (`GET /judgment/courts/`), with pending counts. */
export function useJudgmentCourts() {
  return useQuery({
    queryKey: judgmentKeys.courts(),
    queryFn: async () => (await judgmentApi.courts()).data,
    staleTime: 60_000,
  });
}

/**
 * The reassign picker's list (`GET /judgment/assignable-officers/`): officers these
 * cases may be reassigned to, by the same rule `reassign` checks. Needs `judgment.assign`
 * — which is what a MODERATOR has and `/users/` (`user.manage`) is not.
 */
export function useAssignableOfficers(ids: readonly string[], enabled = true) {
  return useQuery({
    queryKey: judgmentKeys.assignableOfficers(ids),
    queryFn: async () => (await judgmentApi.assignableOfficers(ids)).data,
    enabled: enabled && ids.length > 0,
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
