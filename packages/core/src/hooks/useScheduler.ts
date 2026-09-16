"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { schedulerApi, type ScheduledJob, type ScheduledJobUpdate, type TaskRunFilters } from "../api/index";
import { schedulerKeys } from "../query_keys";

/**
 * Refresh policy for the scheduler page, decided by the user 2026-09-17:
 * realtime push + polling fallback + a manual button, all three.
 *
 *   - socket connected, nothing in flight → poll every 60 s (the push does the work)
 *   - socket down, OR any visible run PENDING/RUNNING → every 5 s
 *   - tab hidden → no polling at all
 *
 * The last one is TanStack's own `refetchIntervalInBackground: false`, which
 * pauses interval refetches while its `focusManager` says the app is not
 * focused — on the web that manager listens to `visibilitychange`. It is set
 * explicitly rather than left to the default so a later "keep it fresh in the
 * background" edit has to delete a line with this comment on it. Nothing here
 * touches `document`: the package cannot, and does not need to.
 */
export const SCHEDULER_POLL_FAST_MS = 5_000;
export const SCHEDULER_POLL_SLOW_MS = 60_000;

const IN_FLIGHT = new Set(["PENDING", "RUNNING"]);

export function schedulerPollInterval(realtimeConnected: boolean, statuses: readonly (string | null | undefined)[]): number {
  if (!realtimeConnected) return SCHEDULER_POLL_FAST_MS;
  return statuses.some((s) => s != null && IN_FLIGHT.has(s)) ? SCHEDULER_POLL_FAST_MS : SCHEDULER_POLL_SLOW_MS;
}

interface LiveOptions {
  /** Whether the realtime socket is up. The host knows; the package does not. */
  realtimeConnected: boolean;
  enabled?: boolean;
}

export function useScheduledJobs({ realtimeConnected, enabled = true }: LiveOptions) {
  return useQuery({
    queryKey: schedulerKeys.jobs,
    queryFn: async () => (await schedulerApi.jobs()).data,
    enabled,
    refetchInterval: (query) =>
      schedulerPollInterval(realtimeConnected, (query.state.data ?? []).map((job) => job.last_run?.status)),
    refetchIntervalInBackground: false,
  });
}

export function useTaskRuns(filters: TaskRunFilters, { realtimeConnected, enabled = true }: LiveOptions) {
  return useQuery({
    queryKey: schedulerKeys.runs.list({ ...filters }),
    queryFn: async () => (await schedulerApi.runs(filters)).data,
    enabled,
    // A page turn or a status filter keeps the old page on screen until the new one lands.
    placeholderData: (previous) => previous,
    refetchInterval: (query) =>
      schedulerPollInterval(realtimeConnected, (query.state.data?.results ?? []).map((run) => run.status)),
    refetchIntervalInBackground: false,
  });
}

export function useUpdateScheduledJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ScheduledJobUpdate }) =>
      (await schedulerApi.updateJob(id, data)).data,
    onSuccess: (row) => {
      // The 200 IS the full row, so the list shows it immediately; the
      // invalidate still runs because next_run_at / overdue are computed
      // server-side and a sibling may have been touched by someone else.
      qc.setQueryData<ScheduledJob[]>(schedulerKeys.jobs, (rows) => rows?.map((r) => (r.id === row.id ? row : r)));
      qc.invalidateQueries({ queryKey: schedulerKeys.jobs });
    },
  });
}

export function useRunScheduledJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await schedulerApi.runJob(id)).data,
    // Both halves: the job row's last_run and the drawer's run list.
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulerKeys.all }),
  });
}

export function useRebuildSchedules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await schedulerApi.rebuild()).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulerKeys.all }),
  });
}

/**
 * What a failed scheduler write means, read off the axios error. Status codes
 * are the contract in `backend/apps/scheduler/views.py`:
 *   409 → a run of this job holds the lock
 *   503 → the broker refused the message
 *   400 → field errors, keyed `cron` or `timezone` (a string or a list)
 *   403 → not allowed
 */
export type SchedulerWriteError =
  | { kind: "locked" }
  | { kind: "enqueue_failed" }
  | { kind: "forbidden" }
  | { kind: "invalid"; fields: Record<string, string[]> }
  | { kind: "other" };

export function classifySchedulerError(error: unknown): SchedulerWriteError {
  const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
  switch (response?.status) {
    case 409:
      return { kind: "locked" };
    case 503:
      return { kind: "enqueue_failed" };
    case 403:
      return { kind: "forbidden" };
    case 400: {
      const fields: Record<string, string[]> = {};
      const data = response.data;
      if (data && typeof data === "object") {
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          const messages = (Array.isArray(value) ? value : [value]).filter((m): m is string => typeof m === "string");
          if (messages.length > 0) fields[key] = messages;
        }
      }
      return { kind: "invalid", fields };
    }
    default:
      return { kind: "other" };
  }
}
