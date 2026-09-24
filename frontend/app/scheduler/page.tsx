"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { ScheduledJob } from "@soulledger/core/api";
import { schedulerKeys } from "@soulledger/core/query_keys";
import {
  classifySchedulerError,
  useRebuildSchedules,
  useRunScheduledJob,
  useScheduledJobs,
  useUpdateScheduledJob,
} from "@soulledger/core/hooks/useScheduler";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useWebSocket } from "@/src/contexts/WebSocketContext";
import type { SchedulerEventPayload } from "@/lib/events/event_registry";
import { usePermissions } from "@/src/hooks/usePermissions";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { QueryError } from "@/src/components/ui/PageError";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { ListSkeleton } from "@/components/ui/skeleton";
import { JOB_ROW_GRID, SchedulerJobRow, useJobName } from "@/src/components/scheduler/SchedulerJobRow";
import { ScheduleEditorModal } from "@/src/components/scheduler/ScheduleEditorModal";
import { TaskRunsDrawer } from "@/src/components/scheduler/TaskRunsDrawer";
import { RunHistoryPanel } from "@/src/components/scheduler/RunHistoryPanel";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";
import { JOB_FILTERS, groupJobs, matchesFilter, type JobFilter } from "@/src/components/scheduler/schedulerView";

function SchedulerPageContent() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { isConnected, subscribe } = useWebSocket();
  // Codenames, not role names: `scheduler.manage` can be granted to any role
  // in the permission matrix. `isAdmin` is only for rebuild, which the backend
  // refuses to anyone who is not tenant-exempt (views.py `rebuild`).
  const { hasPermission, isAdmin } = usePermissions();
  const canManage = hasPermission("scheduler.manage");
  const jobName = useJobName();

  const jobs = useScheduledJobs({ realtimeConnected: isConnected });
  const update = useUpdateScheduledJob();
  const run = useRunScheduledJob();
  const rebuild = useRebuildSchedules();

  const [tab, setTab] = useState<"jobs" | "history">("jobs");
  const [filter, setFilter] = useState<JobFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ScheduledJob | null>(null);
  const [confirmRun, setConfirmRun] = useState<ScheduledJob | null>(null);
  const [runsFor, setRunsFor] = useState<ScheduledJob | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const all = useMemo(() => jobs.data ?? [], [jobs.data]);
  const groups = useMemo(() => groupJobs(all.filter((job) => matchesFilter(job, filter))), [all, filter]);

  // One toast per run that reaches FAILURE or LOST, while this page is open
  // (user decision 2026-09-20). Every other status stays refresh-only — the
  // registry's `handleSchedulerEvent` does the refresh, silently, everywhere.
  // Off RUN_UPDATED rather than the SCHEDULER_RUN_FAILED EventType: GLOBAL
  // runs never emit the latter, and the ADMINs watching this page own them.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.domain !== "scheduler" || event.event !== "SCHEDULER_RUN_UPDATED") return;
        const payload = event as SchedulerEventPayload;
        const status = payload.status;
        if (status !== "FAILURE" && status !== "LOST") return;
        const row = queryClient.getQueryData<ScheduledJob[]>(schedulerKeys.jobs)?.find((j) => j.id === payload.job_id);
        const job = row ? jobName(row) : (payload.task_name ?? "");
        showToast(t(status === "LOST" ? "scheduler.realtime.run_lost" : "scheduler.realtime.run_failed", { job }), "error");
      }),
    [subscribe, queryClient, jobName, showToast, t]
  );

  const toggle = (job: ScheduledJob) =>
    update.mutate(
      { id: job.id, data: { enabled: !job.enabled } },
      {
        onSuccess: (row) => showToast(row.enabled ? t("scheduler.toggle.enabled") : t("scheduler.toggle.disabled"), "success"),
        onError: () => showToast(t("scheduler.toggle.failed"), "error"),
      }
    );

  const runNow = async (job: ScheduledJob) => {
    try {
      await run.mutateAsync(job.id);
      showToast(t("scheduler.run.queued"), "success");
    } catch (error) {
      const failure = classifySchedulerError(error);
      if (failure.kind === "locked") {
        showToast(t("scheduler.run.locked"), "error");
        // The lock means a run exists that this page may not be showing yet.
        void queryClient.invalidateQueries({ queryKey: schedulerKeys.all });
      } else if (failure.kind === "enqueue_failed") {
        showToast(t("scheduler.run.enqueue_failed"), "error");
      } else {
        showToast(t("scheduler.run.failed"), "error");
      }
    } finally {
      setConfirmRun(null);
    }
  };

  const doRebuild = async () => {
    try {
      const stats = await rebuild.mutateAsync();
      showToast(
        t("scheduler.rebuild_done", {
          created: String(stats.created),
          updated: String(stats.updated),
          removed: String(stats.removed),
          legacy_removed: String(stats.legacy_removed),
        }),
        "success"
      );
    } catch {
      showToast(t("scheduler.rebuild_failed"), "error");
    } finally {
      setConfirmRebuild(false);
    }
  };

  const title = (
    <>
      {t("scheduler.title")}
      <MenuGloss path="/scheduler" />
    </>
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => void queryClient.invalidateQueries({ queryKey: schedulerKeys.all })}
        aria-busy={jobs.isFetching}
      >
        <RefreshCw aria-hidden="true" className={`w-4 h-4 mr-1 inline ${jobs.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {t("scheduler.refresh")}
      </Button>
      {isAdmin && canManage && (
        <Button type="button" variant="warning" size="sm" onClick={() => setConfirmRebuild(true)}>
          {t("scheduler.rebuild")}
        </Button>
      )}
    </div>
  );

  // aria-pressed, not role="tab": see the note on the same bar in app/notifications/page.tsx.
  const tabs = (
    <>
      {(["jobs", "history"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={tab === value}
          onClick={() => setTab(value)}
          className={`${TAB_BASE} ${tab === value ? TAB_ON : TAB_OFF}`}
        >
          {t(`scheduler.tabs.${value}`)}
        </button>
      ))}
    </>
  );

  const filters = (
    <div role="group" aria-label={t("scheduler.filters.label")} className="flex flex-wrap gap-2">
      {/* 筛选签(规范 v1 §2)。单选:按下一枚即换成它,再按一下回到「全部」。 */}
      {JOB_FILTERS.map((value) => (
        <FilterChipToggle
          key={value}
          pressed={filter === value}
          onPressedChange={(pressed) => setFilter(pressed ? value : "all")}
        >
          {t(`scheduler.filters.${value}`)}
        </FilterChipToggle>
      ))}
    </div>
  );

  // Three states that must not read alike: the request failed, nothing is
  // registered, and the filter hides everything. A failed poll AFTER data
  // arrived keeps the rows — `isError` alone would blank a working page for
  // one dropped request.
  const failed = jobs.isError && !jobs.data;
  const empty = failed ? (
    <QueryError onRetry={() => jobs.refetch()} />
  ) : all.length === 0 ? (
    <EmptyState title={t("scheduler.empty.no_jobs")} reason={t("scheduler.empty.no_jobs_reason")} />
  ) : (
    <EmptyState
      title={t("scheduler.empty.no_match")}
      action={
        <Button type="button" size="sm" variant="secondary" onClick={() => setFilter("all")}>
          {t("scheduler.filters.all")}
        </Button>
      }
    />
  );

  return (
    <PageShell
      variant="full"
      title={title}
      subtitle={canManage ? t("scheduler.subtitle") : `${t("scheduler.subtitle")} · ${t("scheduler.manage_hint")}`}
      actions={actions}
      tabs={tabs}
      filters={tab === "jobs" ? filters : undefined}
      isLoading={jobs.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={tab === "jobs" && (failed || groups.length === 0)}
      empty={empty}
    >
      {tab === "history" ? (
        <RunHistoryPanel jobs={all} jobName={jobName} showTenant={isAdmin} realtimeConnected={isConnected} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const open = !collapsed.has(group.key);
            const bodyId = `scheduler-group-${group.key.replace(/[^\w-]/g, "_")}`;
            return (
              <section
                key={group.key}
                className="border-t border-[oklch(var(--color-block))]"
                data-group={group.key}
              >
                <h2 className="font-mono text-2xs uppercase text-[oklch(var(--color-ink-muted))]">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-[oklch(var(--color-surface-2))] transition-colors"
                  >
                    <span className="min-w-0 break-words">
                      {group.tenantCode === null ? t("scheduler.groups.global") : t("scheduler.groups.tenant", { code: group.tenantCode })}
                      {" · "}
                      {t("scheduler.groups.count", { count: String(group.jobs.length) })}
                    </span>
                    <ChevronDown aria-hidden="true" className={`w-4 h-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
                  </button>
                </h2>
                {open && (
                  <div id={bodyId}>
                    <div
                      aria-hidden="true"
                      className={`hidden px-4 py-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-block))] ${JOB_ROW_GRID}`}
                    >
                      <span />
                      <span>{t("scheduler.fields.schedule")}</span>
                      <span>{t("scheduler.fields.last_run")}</span>
                      <span>{t("scheduler.fields.next_run")}</span>
                      <span />
                    </div>
                    <ul>
                      {group.jobs.map((job) => (
                        <SchedulerJobRow
                          key={job.id}
                          job={job}
                          canManage={canManage}
                          togglePending={update.isPending && update.variables?.id === job.id}
                          onToggle={toggle}
                          onRun={setConfirmRun}
                          onEdit={setEditing}
                          onShowRuns={setRunsFor}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editing && <ScheduleEditorModal key={editing.id} job={editing} jobName={jobName(editing)} onClose={() => setEditing(null)} />}

      {runsFor && (
        <TaskRunsDrawer job={runsFor} jobName={jobName(runsFor)} realtimeConnected={isConnected} onClose={() => setRunsFor(null)} />
      )}

      <ConfirmDialog
        isOpen={confirmRun !== null}
        title={t("scheduler.run.confirm_title")}
        message={confirmRun ? t("scheduler.run.confirm_message", { job: jobName(confirmRun) }) : ""}
        confirmText={t("scheduler.actions.run_now")}
        variant="info"
        confirmLoading={run.isPending}
        onCancel={() => setConfirmRun(null)}
        onConfirm={() => confirmRun && void runNow(confirmRun)}
      />

      <ConfirmDialog
        isOpen={confirmRebuild}
        title={t("scheduler.rebuild_confirm_title")}
        message={t("scheduler.rebuild_confirm_message")}
        confirmText={t("scheduler.rebuild")}
        variant="warning"
        confirmLoading={rebuild.isPending}
        onCancel={() => setConfirmRebuild(false)}
        onConfirm={() => void doRebuild()}
      />
    </PageShell>
  );
}

export default function SchedulerPage() {
  return (
    <RequirePermission permissions="scheduler.read" fallback={<PermissionDenied />}>
      <SchedulerPageContent />
    </RequirePermission>
  );
}
