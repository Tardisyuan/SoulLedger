import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * `/api/v1/scheduler/` — backend/apps/scheduler/{views,serializers}.py.
 *
 * The unions are spelled out rather than aliased from the generated schema;
 * `frontend/src/__tests__/enumsMatchTheSchema.test.ts` explains why and holds
 * each one equal to its schema component.
 */

export type TaskRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILURE" | "RETRY" | "SKIPPED" | "LOST";

export type TaskRunTrigger = "SCHEDULE" | "MANUAL";

export type ScheduledJobScope = "TENANT" | "GLOBAL";

/** TaskRunSummarySerializer — the `last_run` on a job row. */
export interface TaskRunSummary {
  id: number;
  status: TaskRunStatus;
  trigger: TaskRunTrigger;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

/** ScheduledJobSerializer. One row per (job, tenant); `tenant` null = GLOBAL. */
export interface ScheduledJob {
  id: number;
  job_key: string;
  periodic_task_name: string;
  task_name: string;
  scope: ScheduledJobScope;
  tenant: number | null;
  tenant_code: string | null;
  description_key: string;
  enabled: boolean;
  minute: string | null;
  hour: string | null;
  day_of_month: string | null;
  month_of_year: string | null;
  day_of_week: string | null;
  timezone: string;
  max_runtime_seconds: number;
  next_run_at: string | null;
  last_run: TaskRunSummary | null;
  overdue: boolean;
  expected_at: string | null;
  consecutive_failures: number;
  last_alerted_at: string | null;
}

/** TaskRunSerializer. `error` is truncated server-side (≤4000 chars, traceback tail). */
export interface TaskRun extends TaskRunSummary {
  job: number | null;
  task_name: string;
  celery_task_id: string;
  tenant: number | null;
  worker_hostname: string;
  error: string;
  result: string;
  triggered_by: number | null;
  triggered_by_username: string | null;
}

/** PATCH body: any subset. There is no PUT. 400 is `{cron: [...]}` or `{timezone: [...]}`. */
export interface ScheduledJobUpdate {
  enabled?: boolean;
  minute?: string;
  hour?: string;
  day_of_month?: string;
  month_of_year?: string;
  day_of_week?: string;
  timezone?: string;
}

export interface RebuildResult {
  created: number;
  updated: number;
  removed: number;
  legacy_removed: number;
}

export interface TaskRunFilters {
  job?: number;
  status?: string;
  tenant?: number;
  task_name?: string;
  trigger?: string;
  page?: number;
}

export const schedulerApi = {
  /** Not paginated: a bare array. */
  jobs: () => api.get<ScheduledJob[]>("/scheduler/jobs/"),
  updateJob: (id: number, data: ScheduledJobUpdate) => api.patch<ScheduledJob>(`/scheduler/jobs/${id}/`, data),
  /** 202 with a PENDING/MANUAL run; 409 while a run holds the lock; 503 when enqueue failed. */
  runJob: (id: number) => api.post<TaskRun>(`/scheduler/jobs/${id}/run/`),
  /** ADMIN only (403 otherwise). */
  rebuild: () => api.post<RebuildResult>("/scheduler/jobs/rebuild/"),
  runs: (params: TaskRunFilters) => api.get<PaginatedResponse<TaskRun>>("/scheduler/runs/", { params }),
};
