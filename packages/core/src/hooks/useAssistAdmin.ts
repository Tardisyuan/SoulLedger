"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assistAdminApi,
  type AssistAdminCandidate,
  type AssistAdminConfigUpdate,
  type AssistAdminEvalSide,
  type AssistAdminHall,
  type AssistAdminTryRequest,
} from "../api/assist-admin";
import { assistAdminKeys } from "../query_keys";

/** An eval run is still moving while queued or running; poll it until it is not. */
export const ASSIST_EVAL_POLL_MS = 3_000;
const IN_FLIGHT = new Set(["queued", "running"]);
export const evalRunInFlight = (status: string | undefined) => IN_FLIGHT.has(status ?? "queued");

export function useAssistAdminConfig(enabled = true) {
  return useQuery({ queryKey: assistAdminKeys.config, queryFn: assistAdminApi.config, enabled });
}

export function useUpdateAssistAdminConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssistAdminConfigUpdate) => assistAdminApi.updateConfig(body),
    onSuccess: (config) => {
      qc.setQueryData(assistAdminKeys.config, config);
      void qc.invalidateQueries({ queryKey: ["assist-admin", "usage"] });
    },
  });
}

export function useTestAssistConnection() {
  return useMutation({ mutationFn: (body: AssistAdminCandidate) => assistAdminApi.testConnection(body) });
}

export function useAssistAdminHalls(enabled = true) {
  return useQuery({ queryKey: assistAdminKeys.halls, queryFn: assistAdminApi.halls, enabled });
}

/** Per-hall switch: written at once, not part of the config draft (canvas 1a 三). */
export function useUpdateAssistHall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => assistAdminApi.updateHall(id, on),
    onSuccess: (hall) =>
      qc.setQueryData<AssistAdminHall[]>(assistAdminKeys.halls, (rows) => rows?.map((h) => (h.id === hall.id ? hall : h))),
  });
}

export function useEnsureEvalIdentities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assistAdminApi.ensureEvalIdentities,
    onSuccess: () => void qc.invalidateQueries({ queryKey: assistAdminKeys.config }),
  });
}

export function useEvalPreview() {
  return useMutation({
    mutationFn: ({ side, candidates }: { side: AssistAdminEvalSide; candidates: AssistAdminCandidate[] }) =>
      assistAdminApi.evalPreview(side, candidates),
  });
}

export function useStartEval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => assistAdminApi.evalStart(token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: assistAdminKeys.runs }),
  });
}

export function useEvalRuns(enabled = true) {
  return useQuery({
    queryKey: assistAdminKeys.runs,
    queryFn: assistAdminApi.evalRuns,
    enabled,
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => evalRunInFlight(r.status)) ? ASSIST_EVAL_POLL_MS : false),
    refetchIntervalInBackground: false,
  });
}

export function useEvalRun(id: number | null) {
  return useQuery({
    queryKey: assistAdminKeys.run(id ?? 0),
    queryFn: () => assistAdminApi.evalRun(id as number),
    enabled: id != null,
    refetchInterval: (q) => (q.state.data && evalRunInFlight(q.state.data.status) ? ASSIST_EVAL_POLL_MS : false),
    refetchIntervalInBackground: false,
  });
}

export function useAssistUsage(month: string | undefined, enabled = true) {
  return useQuery({ queryKey: assistAdminKeys.usage(month), queryFn: () => assistAdminApi.usage(month), enabled });
}

export function useEvalCases(enabled = true) {
  return useQuery({ queryKey: [...assistAdminKeys.all, "eval-cases"], queryFn: assistAdminApi.evalCases, enabled });
}

/** 试问: a mutation, never retried — every call is a paid request. */
export function useAssistTry() {
  return useMutation({ mutationFn: (body: AssistAdminTryRequest) => assistAdminApi.tryQuestion(body) });
}

/** The corpus ships with the code, so it does not change under a running page. */
export function useAssistCorpus(enabled = true) {
  return useQuery({ queryKey: [...assistAdminKeys.all, "corpus"], queryFn: assistAdminApi.corpus, enabled, staleTime: Infinity });
}
