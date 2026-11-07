"use client";

import { useId, useState, type ReactNode } from "react";
import { PAGE_SIZE, type ScheduledJob, type TaskRun, type TaskRunStatus } from "@soulledger/core/api";
import { useTaskRuns } from "@soulledger/core/hooks/useScheduler";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Drawer } from "@/src/components/ui/Drawer";
import { Collapse } from "@/src/components/ui/Collapse";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { SelectField } from "@/src/components/ui/Field";
import { Pagination } from "@/src/components/ui/Pagination";
import { QueryError } from "@/src/components/ui/PageError";
import { Spinner } from "@/src/components/ui/Spinner";
import { durationParts } from "./schedulerView";
import { RunStatusBadge } from "./SchedulerJobRow";

export const RUN_STATUSES: TaskRunStatus[] = ["PENDING", "RUNNING", "SUCCESS", "FAILURE", "RETRY", "SKIPPED", "LOST"];

interface Props {
  job: ScheduledJob;
  jobName: string;
  realtimeConnected: boolean;
  onClose: () => void;
}

/**
 * Right-hand run history on the shared `ui/Drawer` (scrim `--color-scrim`, focus trap, Escape);
 * mounted only while a job is chosen, so a closed drawer is absent from the DOM.
 */
export function TaskRunsDrawer({ job, jobName, realtimeConnected, onClose }: Props) {
  const { t, formatDateTime } = useI18n();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const statusFilter = status === "" ? undefined : status;

  const runs = useTaskRuns(
    { job: job.id, status: statusFilter, page },
    { realtimeConnected }
  );
  const results = runs.data?.results ?? [];
  const totalPages = runs.data ? Math.max(1, Math.ceil(runs.data.count / PAGE_SIZE)) : 0;

  return (
    <Drawer isOpen onClose={onClose} title={t("scheduler.runs.title", { job: jobName })}>
        <div className="space-y-4">
          <SelectField
            label={t("scheduler.runs.status_filter")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[
              { value: "", label: t("scheduler.runs.all_statuses") },
              ...RUN_STATUSES.map((s) => ({ value: s, label: t(`scheduler.status.${s}`) })),
            ]}
          />

          {runs.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : runs.isError && !runs.data ? (
            <QueryError onRetry={() => runs.refetch()} />
          ) : results.length === 0 ? (
            <EmptyState title={status ? t("scheduler.runs.empty_filtered") : t("scheduler.runs.empty")} />
          ) : (
            <>
              <ul className="divide-y divide-[oklch(var(--color-line))]" data-testid="task-runs">
                {results.map((run) => (
                  <TaskRunItem key={run.id} run={run} formatDateTime={formatDateTime} />
                ))}
              </ul>
              <Pagination page={page} totalPages={totalPages} count={runs.data?.count ?? 0} onPageChange={setPage} />
            </>
          )}
        </div>
    </Drawer>
  );
}

/** One run. `heading` names the job and tenant where the list spans many jobs (the history tab). */
export function TaskRunItem({
  run,
  formatDateTime,
  heading,
}: {
  run: TaskRun;
  formatDateTime: (v: string) => string;
  heading?: ReactNode;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const errorId = useId();
  const duration = run.duration_ms === null ? null : durationParts(run.duration_ms);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(run.error);
      showToast(t("scheduler.runs.error_copied"), "success");
    } catch {
      showToast(t("common.value.id_copy_failed"), "error");
    }
  };

  return (
    <li className="py-3 space-y-2" data-run-status={run.status}>
      {heading}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RunStatusBadge status={run.status} />
        <DomainEnum namespace="scheduler.trigger" value={run.trigger} className="text-xs text-[oklch(var(--color-ink-muted))]" />
        {run.triggered_by_username && (
          <span className="text-xs text-[oklch(var(--color-ink-muted))] break-all">
            {t("scheduler.runs.triggered_by")}: {run.triggered_by_username}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[oklch(var(--color-ink-subtle))]">{t("scheduler.runs.queued_at")}</dt>
        <dd className="font-mono">{formatDateTime(run.queued_at)}</dd>
        <dt className="text-[oklch(var(--color-ink-subtle))]">{t("scheduler.runs.started_at")}</dt>
        <dd className="font-mono">{run.started_at ? formatDateTime(run.started_at) : <MissingValue kind="unrecorded" />}</dd>
        <dt className="text-[oklch(var(--color-ink-subtle))]">{t("scheduler.runs.finished_at")}</dt>
        <dd className="font-mono">{run.finished_at ? formatDateTime(run.finished_at) : <MissingValue kind="unrecorded" />}</dd>
        <dt className="text-[oklch(var(--color-ink-subtle))]">{t("scheduler.runs.duration")}</dt>
        <dd className="font-mono">{duration ? t(duration.key, { value: duration.value }) : <MissingValue kind="unrecorded" />}</dd>
        <dt className="text-[oklch(var(--color-ink-subtle))]">{t("scheduler.runs.worker")}</dt>
        <dd className="font-mono break-all">{run.worker_hostname || <MissingValue kind="unrecorded" />}</dd>
      </dl>
      {run.error && (
        <div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" aria-expanded={open} aria-controls={errorId} onClick={() => setOpen((o) => !o)}>
              {open ? t("scheduler.runs.hide_error") : t("scheduler.runs.show_error")}
            </Button>
            {open && (
              <Button type="button" size="sm" variant="ghost" onClick={copy}>
                {t("scheduler.runs.copy_error")}
              </Button>
            )}
          </div>
          {/* Wrapped, not horizontally scrolled: a traceback line is often
              wider than a phone, and a nested scroller inside a scrolling
              drawer is two scroll axes to fight with one thumb. */}
          <Collapse open={open} id={errorId} className="mt-2">
            <pre
              aria-label={t("scheduler.runs.error")}
              className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words select-text bg-[oklch(var(--color-surface-2))] border border-[oklch(var(--color-line))] p-3 font-mono text-xs text-[oklch(var(--color-ink))]"
            >
              {run.error}
            </pre>
          </Collapse>
        </div>
      )}
    </li>
  );
}
