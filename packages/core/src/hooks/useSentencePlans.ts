"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sentencePlansApi, type SentencePlanFilters } from "../api/sentence-plans";
import { sentencePlanKeys, soulKeys } from "../query_keys";

/**
 * Sentence plans, officer side. Every write invalidates the plan root, and the
 * soul root too: an accepted request can send the soul on to its next stop, and
 * a cancelled plan moves the soul to REINCARNATING / SETTLED (D1).
 */

export function useSentencePlans(filters: SentencePlanFilters, enabled = true) {
  return useQuery({
    queryKey: sentencePlanKeys.list({ ...filters }),
    queryFn: async () => (await sentencePlansApi.list(filters)).data,
    enabled,
    placeholderData: (previous) => previous,
  });
}

function usePlanWrite<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: sentencePlanKeys.all }),
        qc.invalidateQueries({ queryKey: soulKeys.all }),
      ]),
  });
}

export function useDecideSentenceRequest() {
  return usePlanWrite(
    async (v: { planId: string; requestId: string; decision: "ACCEPT" | "REJECT"; reason?: string }) =>
      (await sentencePlansApi.decide(v.planId, v.requestId, { decision: v.decision, reason: v.reason })).data,
  );
}

export function useWithdrawSentenceRequest() {
  return usePlanWrite(
    async (v: { planId: string; requestId: string }) => (await sentencePlansApi.withdraw(v.planId, v.requestId)).data,
  );
}

export function useCancelSentencePlan() {
  return usePlanWrite(
    async (v: { planId: string; reason: string }) => (await sentencePlansApi.cancel(v.planId, v.reason)).data,
  );
}
