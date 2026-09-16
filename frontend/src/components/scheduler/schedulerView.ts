import type { ScheduledJob } from "@soulledger/core/api";
import { zoneOffsetMs, type CronFields } from "@soulledger/core/domain/cron";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";

export type JobFilter = "all" | "disabled" | "overdue" | "failing";
export const JOB_FILTERS: JobFilter[] = ["all", "disabled", "overdue", "failing"];

export function matchesFilter(job: ScheduledJob, filter: JobFilter): boolean {
  switch (filter) {
    case "disabled":
      return !job.enabled;
    case "overdue":
      return job.overdue;
    case "failing":
      return job.consecutive_failures > 0;
    default:
      return true;
  }
}

export interface JobGroup {
  /** "global" or "tenant:<code>" — stable across refetches, so collapse state survives a poll. */
  key: string;
  tenantCode: string | null;
  jobs: ScheduledJob[];
}

/**
 * Global first, then one group per tenant by code. Grouped on `tenant`, not
 * `scope`: a row is global exactly when it has no tenant (that is how the
 * backend's `scope_to_tenant` decides who may see it), so a scope/tenant
 * disagreement cannot hide a row in a group that does not exist.
 */
export function groupJobs(jobs: readonly ScheduledJob[]): JobGroup[] {
  const groups = new Map<string, JobGroup>();
  for (const job of jobs) {
    const code = job.tenant === null ? null : (job.tenant_code ?? String(job.tenant));
    const key = code === null ? "global" : `tenant:${code}`;
    if (!groups.has(key)) groups.set(key, { key, tenantCode: code, jobs: [] });
    groups.get(key)!.jobs.push(job);
  }
  return [...groups.values()].sort((a, b) =>
    a.tenantCode === null ? -1 : b.tenantCode === null ? 1 : a.tenantCode.localeCompare(b.tenantCode)
  );
}

/** Null when the row carries no crontab at all (the serializer allows null fields). */
export function jobCron(job: ScheduledJob): CronFields | null {
  const { minute, hour, day_of_month, month_of_year, day_of_week } = job;
  if (minute === null || hour === null || day_of_month === null || month_of_year === null || day_of_week === null) {
    return null;
  }
  return { minute, hour, day_of_month, month_of_year, day_of_week };
}

/** Pinned by the user 2026-09-17: the zones of the four civilizations plus UTC. */
export const COMMON_TIMEZONES = ["UTC", "Asia/Shanghai", "Africa/Cairo", "Europe/Rome", "Europe/Athens"];

export function allTimezones(): string[] {
  // `supportedValuesOf` is ES2022; the fallback keeps the picker usable on an
  // engine without it rather than throwing the page into its error boundary.
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? COMMON_TIMEZONES;
}

/** "UTC+08:00" for the zone right now; null for a name Intl does not know. */
export function utcOffsetLabel(timeZone: string, at: number = Date.now()): string | null {
  try {
    const minutes = Math.round(zoneOffsetMs(at, timeZone) / 60_000);
    const sign = minutes < 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

/**
 * Run status → badge TONE, not → token: the tone table in `Badge.tsx` owns the
 * tokens (statusTokenLayering.test.ts). Unlisted — SKIPPED, or a member this
 * build does not know — is neutral.
 */
export const RUN_STATUS_TONE: Record<string, BadgeTone> = {
  SUCCESS: "success",
  FAILURE: "error",
  LOST: "error",
  RETRY: "warning",
  RUNNING: "info",
  PENDING: "info",
};

export function runStatusBadgeClass(status: string): string {
  return badgeVariants({ tone: RUN_STATUS_TONE[status] ?? "neutral" });
}

/** Duration copy key + value: under a second in ms, otherwise seconds to one decimal. */
export function durationParts(ms: number): { key: "scheduler.duration.ms" | "scheduler.duration.s"; value: string } {
  return ms < 1000
    ? { key: "scheduler.duration.ms", value: String(ms) }
    : { key: "scheduler.duration.s", value: (ms / 1000).toFixed(1) };
}
