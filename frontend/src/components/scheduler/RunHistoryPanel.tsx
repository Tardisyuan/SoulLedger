"use client";

import { useEffect, useMemo, useState } from "react";
import { PAGE_SIZE, type ScheduledJob, type TaskRunStatus, type TaskRunTrigger } from "@soulledger/core/api";
import { useTaskRuns } from "@soulledger/core/hooks/useScheduler";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { Pagination } from "@/src/components/ui/Pagination";
import { QueryError } from "@/src/components/ui/PageError";
import { Spinner } from "@/src/components/ui/Spinner";
import { RUN_STATUSES, TaskRunItem } from "./TaskRunsDrawer";

/** What the tab opens on (user decision 2026-09-20): the runs someone has to look at. */
export const DEFAULT_HISTORY_STATUSES: TaskRunStatus[] = ["FAILURE", "LOST"];
const TRIGGERS: TaskRunTrigger[] = ["SCHEDULE", "MANUAL"];
const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  /** The job list the page already holds — the job and tenant options come from it, no second request. */
  jobs: readonly ScheduledJob[];
  jobName: (job: ScheduledJob) => string;
  /**
   * Show the tenant filter. The backend's `scope_to_tenant` is the real guard;
   * this only hides a control whose every option but one would return nothing.
   */
  showTenant: boolean;
  realtimeConnected: boolean;
}

/** `<input type="datetime-local">` value (local wall time) → ISO, or undefined when empty/invalid. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/**
 * Every job's runs in one list, newest first. Realtime needs nothing here:
 * `handleSchedulerEvent` invalidates `schedulerKeys.all`, which this list's
 * `schedulerKeys.runs.list(...)` sits under.
 */
export function RunHistoryPanel({ jobs, jobName, showTenant, realtimeConnected }: Props) {
  const { t, formatDateTime } = useI18n();
  const [statuses, setStatuses] = useState<TaskRunStatus[]>(DEFAULT_HISTORY_STATUSES);
  const [taskName, setTaskName] = useState("");
  const [tenant, setTenant] = useState("");
  const [trigger, setTrigger] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchDraft]);

  // Any filter change goes back to page 1: page 4 of the old filter is not a place in the new one.
  const set = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const runs = useTaskRuns(
    {
      status: statuses.length > 0 ? statuses.join(",") : undefined,
      task_name: taskName || undefined,
      tenant: tenant ? Number(tenant) : undefined,
      trigger: trigger || undefined,
      queued_after: toIso(from),
      queued_before: toIso(to),
      search: search || undefined,
      page,
    },
    { realtimeConnected }
  );
  const results = runs.data?.results ?? [];
  const totalPages = runs.data ? Math.max(1, Math.ceil(runs.data.count / PAGE_SIZE)) : 0;

  // One option per task, labelled by its translated name; the tenant filter separates the rows.
  const taskOptions = useMemo(() => {
    const byTask = new Map<string, string>();
    for (const job of jobs) if (!byTask.has(job.task_name)) byTask.set(job.task_name, jobName(job));
    return [...byTask].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [jobs, jobName]);
  const tenantOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const job of jobs) if (job.tenant !== null) byId.set(job.tenant, job.tenant_code ?? String(job.tenant));
    return [...byId].map(([id, code]) => ({ value: String(id), label: code })).sort((a, b) => a.label.localeCompare(b.label));
  }, [jobs]);
  const nameOfTask = useMemo(() => new Map(taskOptions.map((o) => [o.value, o.label])), [taskOptions]);
  const codeOfTenant = useMemo(() => new Map(tenantOptions.map((o) => [Number(o.value), o.label])), [tenantOptions]);

  const filtered =
    statuses.length > 0 || taskName !== "" || tenant !== "" || trigger !== "" || from !== "" || to !== "" || search !== "";
  const clear = () => {
    setStatuses([]);
    setTaskName("");
    setTenant("");
    setTrigger("");
    setFrom("");
    setTo("");
    setSearchDraft("");
    setSearch("");
    setPage(1);
  };
  const toggleStatus = (s: TaskRunStatus) =>
    set(setStatuses)(statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]);

  return (
    <div className="space-y-4" data-testid="run-history">
      <div role="group" aria-label={t("scheduler.runs.status_filter")} className="flex flex-wrap gap-2">
        {RUN_STATUSES.map((s) => (
          <FilterChipToggle key={s} pressed={statuses.includes(s)} onPressedChange={() => toggleStatus(s)}>
            {t(`scheduler.status.${s}`)}
          </FilterChipToggle>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label={t("scheduler.history.job")}
          value={taskName}
          onChange={(e) => set(setTaskName)(e.target.value)}
          options={[{ value: "", label: t("scheduler.history.all_jobs") }, ...taskOptions]}
        />
        {showTenant && (
          <SelectField
            label={t("scheduler.history.tenant")}
            value={tenant}
            onChange={(e) => set(setTenant)(e.target.value)}
            options={[{ value: "", label: t("scheduler.history.all_tenants") }, ...tenantOptions]}
          />
        )}
        <SelectField
          label={t("scheduler.history.trigger")}
          value={trigger}
          onChange={(e) => set(setTrigger)(e.target.value)}
          options={[
            { value: "", label: t("scheduler.history.all_triggers") },
            ...TRIGGERS.map((v) => ({ value: v, label: t(`scheduler.trigger.${v}`) })),
          ]}
        />
        <TextField
          type="datetime-local"
          label={t("scheduler.history.queued_from")}
          value={from}
          onChange={(e) => set(setFrom)(e.target.value)}
        />
        <TextField
          type="datetime-local"
          label={t("scheduler.history.queued_to")}
          value={to}
          onChange={(e) => set(setTo)(e.target.value)}
        />
        <TextField
          type="search"
          label={t("scheduler.history.search")}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
      </div>

      {filtered && (
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          {t("scheduler.history.clear")}
        </Button>
      )}

      {runs.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : runs.isError && !runs.data ? (
        <QueryError onRetry={() => runs.refetch()} />
      ) : results.length === 0 ? (
        <EmptyState title={filtered ? t("scheduler.history.empty") : t("scheduler.runs.empty")} />
      ) : (
        <>
          <ul className="divide-y divide-[oklch(var(--color-rule))]" data-testid="history-runs">
            {results.map((run) => (
              <TaskRunItem
                key={run.id}
                run={run}
                formatDateTime={formatDateTime}
                heading={
                  <p className="text-sm font-medium text-[oklch(var(--color-ink))] break-words">
                    {nameOfTask.get(run.task_name) ?? run.task_name}
                    <span className="text-xs font-normal text-[oklch(var(--color-ink-muted))]">
                      {" · "}
                      {run.tenant === null
                        ? t("scheduler.groups.global")
                        : t("scheduler.groups.tenant", { code: codeOfTenant.get(run.tenant) ?? String(run.tenant) })}
                    </span>
                  </p>
                }
              />
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} count={runs.data?.count ?? 0} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
