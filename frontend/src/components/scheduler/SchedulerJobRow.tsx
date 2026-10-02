"use client";

import { useCallback } from "react";
import type { ScheduledJob } from "@soulledger/core/api";
import { joinCron, presetFromCron } from "@soulledger/core/domain/cron";
import { useI18n } from "@/src/contexts/I18nContext";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { durationParts, jobCron, runStatusBadgeClass, runStatusGlyph } from "./schedulerView";

export const JOB_DESCRIPTION_NAMESPACE = "scheduler.jobs";

/**
 * `description_key` arrives as a full bundle path (`scheduler.jobs.x`). Split
 * so `<DomainEnum>` resolves it: a known key renders its copy, an unknown one
 * renders "unrecognized" with the raw key in `title` — never swallowed, never
 * the dotted path as text.
 */
export function jobDescriptionMember(job: ScheduledJob): string {
  const prefix = `${JOB_DESCRIPTION_NAMESPACE}.`;
  return job.description_key.startsWith(prefix) ? job.description_key.slice(prefix.length) : job.description_key;
}

export function useJobName() {
  const { t } = useI18n();
  // Stable per `t`: the page's realtime subscription lists it as a dependency.
  return useCallback(
    (job: ScheduledJob) => {
      const key = job.description_key;
      const translated = key ? t(key) : key;
      // Used where a string is needed (dialog titles). Falls back to the task
      // name, which is what an operator would grep for, never to the dotted key.
      return translated && translated !== key ? translated : job.task_name;
    },
    [t]
  );
}

/** Grid track list shared by the column header and every row, md and up. */
export const JOB_ROW_GRID = "md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-4";

interface Props {
  job: ScheduledJob;
  canManage: boolean;
  onToggle: (job: ScheduledJob) => void;
  onRun: (job: ScheduledJob) => void;
  onEdit: (job: ScheduledJob) => void;
  onShowRuns: (job: ScheduledJob) => void;
  togglePending: boolean;
}

/**
 * One job. A card below `md` (label above each value, stacked) and a grid row
 * from `md` up (labels become the shared column header). No table: a table
 * cannot become a card at 393px without either horizontal scroll or a second
 * copy of the markup.
 */
export function SchedulerJobRow({ job, canManage, onToggle, onRun, onEdit, onShowRuns, togglePending }: Props) {
  const { t, formatDateTime } = useI18n();
  const cron = jobCron(job);
  const preset = cron ? presetFromCron(cron) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const readable =
    preset === null
      ? null
      : preset.kind === "every_n_minutes"
        ? t("scheduler.readable.every_n_minutes", { interval: String(preset.interval) })
        : preset.kind === "hourly"
          ? t("scheduler.readable.hourly", { minute: pad(preset.minute) })
          : preset.kind === "daily"
            ? t("scheduler.readable.daily", { time: `${pad(preset.hour)}:${pad(preset.minute)}` })
            : preset.kind === "weekly"
              ? t("scheduler.readable.weekly", {
                  weekday: t(`scheduler.editor.weekdays.${preset.weekday}`),
                  time: `${pad(preset.hour)}:${pad(preset.minute)}`,
                })
              : t("scheduler.editor.presets.custom");
  const last = job.last_run;
  const lastDuration = last?.duration_ms == null ? null : durationParts(last.duration_ms);
  const label = "md:hidden text-2xs uppercase text-[oklch(var(--color-ink-subtle))]";

  return (
    <li
      className={`p-4 md:py-2 space-y-3 md:space-y-0 border-b border-[oklch(var(--color-rule))] ${JOB_ROW_GRID}${job.enabled ? "" : " opacity-75"}`}
      data-job-id={job.id}
    >
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-medium text-[oklch(var(--color-ink))] break-words">
          <DomainEnum namespace={JOB_DESCRIPTION_NAMESPACE} value={jobDescriptionMember(job)} />
        </h3>
        <p className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))] break-all" title={job.periodic_task_name}>
          {job.periodic_task_name}
        </p>
        <div className="flex flex-wrap gap-1">
          {!job.enabled && <Badge tone="neutral" glyph="○">{t("scheduler.flags.disabled")}</Badge>}
          {job.overdue && (
            <Badge
              tone="warning"
              glyph="◐"
              title={job.expected_at ? t("scheduler.flags.overdue_detail", { time: formatDateTime(job.expected_at) }) : undefined}
            >
              {t("scheduler.flags.overdue")}
            </Badge>
          )}
          {job.consecutive_failures > 0 && (
            <Badge tone="error" glyph="!">{t("scheduler.flags.failures", { count: String(job.consecutive_failures) })}</Badge>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <p className={label}>{t("scheduler.fields.schedule")}</p>
        <p className="text-sm text-[oklch(var(--color-ink))]">{readable ?? <MissingValue kind="unrecorded" />}</p>
        <p className="font-mono text-xs text-[oklch(var(--color-ink-muted))] break-all">
          {cron ? joinCron(cron) : null} · <span title={t("scheduler.fields.timezone")}>{job.timezone}</span>
        </p>
      </div>

      <div className="min-w-0">
        <p className={label}>{t("scheduler.fields.last_run")}</p>
        {last ? (
          <>
            <RunStatusBadge status={last.status} />
            <p className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">
              {formatDateTime(last.started_at ?? last.queued_at)}
              {lastDuration && ` · ${t(lastDuration.key, { value: lastDuration.value })}`}
            </p>
          </>
        ) : (
          <MissingValue kind="unrecorded" reason={t("scheduler.flags.never_run")} />
        )}
      </div>

      <div className="min-w-0">
        <p className={label}>{t("scheduler.fields.next_run")}</p>
        <p className="font-mono text-xs text-[oklch(var(--color-ink))]">
          {job.next_run_at ? (
            formatDateTime(job.next_run_at)
          ) : (
            <MissingValue kind={job.enabled ? "unrecorded" : "inapplicable"} reason={job.enabled ? undefined : t("scheduler.flags.not_scheduled")} />
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {canManage && (
          <button
            type="button"
            role="switch"
            aria-checked={job.enabled}
            aria-label={t("scheduler.actions.toggle", { job: job.task_name })}
            disabled={togglePending}
            onClick={() => onToggle(job)}
            // 规范 v3:控件点击区至少 44(`--control-h-sm`)。开关的样子仍是规范 v2 A1 的 32 × 18
            // 轨道(1.5px 框;开 = ink 实底、纸色滑块在右;关 = 空底、ink3 框与滑块在左;
            // 禁用 = s2 底、line 框,不调透明度;选中不用匾色),现在画在 44 × 44 的按钮里 ——
            // 此前按钮本身就是那条 18 高的轨道,手机上点不准。
            className="group inline-flex size-(--control-h-sm) shrink-0 items-center justify-center disabled:cursor-not-allowed"
          >
            <span
              aria-hidden="true"
              className={`relative inline-flex h-[18px] w-8 items-center border-[1.5px] p-0.5 transition-colors duration-instant group-disabled:border-[oklch(var(--color-line))] group-disabled:bg-[oklch(var(--color-disabled-surface))] ${
                job.enabled
                  ? "justify-end bg-[oklch(var(--color-ink))] border-[oklch(var(--color-ink))]"
                  : "justify-start bg-transparent border-[oklch(var(--color-line-strong))]"
              }`}
            >
              <span
                className={`block size-[11px] ${job.enabled ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-line-strong))]"}`}
              />
            </span>
          </button>
        )}
        {canManage && (
          <Button type="button" size="sm" variant="secondary" onClick={() => onRun(job)}>
            {t("scheduler.actions.run_now")}
          </Button>
        )}
        {canManage && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(job)}>
            {t("scheduler.actions.edit")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => onShowRuns(job)}>
          {t("scheduler.actions.runs")}
        </Button>
      </div>
    </li>
  );
}

/** A run's status as a badge: glyph + translated text, raw member in `title` (spec v3: never colour alone). */
export function RunStatusBadge({ status }: { status: string }) {
  return (
    <span className={runStatusBadgeClass(status)} data-run-status-badge={status}>
      <span aria-hidden="true">{runStatusGlyph(status)}</span>
      <DomainEnum namespace="scheduler.status" value={status} />
    </span>
  );
}
