"use client";

import { useId, useMemo, useState } from "react";
import type { ScheduledJob, ScheduledJobUpdate } from "@soulledger/core/api";
import {
  CRON_FIELDS,
  cronFromPreset,
  nextCronRuns,
  presetFromCron,
  type CronFields,
  type CronPreset,
  type CronPresetKind,
} from "@soulledger/core/domain/cron";
import { classifySchedulerError, useUpdateScheduledJob } from "@soulledger/core/hooks/useScheduler";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { TimezoneSelect } from "./TimezoneSelect";
import { jobCron } from "./schedulerView";

const PRESET_KINDS: CronPresetKind[] = ["every_n_minutes", "hourly", "daily", "weekly", "custom"];

/** What choosing a preset from a schedule that is not already that preset starts from. */
const PRESET_DEFAULTS: Record<Exclude<CronPresetKind, "custom">, CronPreset> = {
  every_n_minutes: { kind: "every_n_minutes", interval: 5 },
  hourly: { kind: "hourly", minute: 0 },
  daily: { kind: "daily", hour: 0, minute: 0 },
  weekly: { kind: "weekly", weekday: 1, hour: 0, minute: 0 },
};

const EMPTY_CRON: CronFields = { minute: "*", hour: "*", day_of_month: "*", month_of_year: "*", day_of_week: "*" };

interface Props {
  job: ScheduledJob;
  jobName: string;
  onClose: () => void;
}

/**
 * Presets and raw cron edit ONE value: the five fields. The preset selector is
 * derived from them on every render (`presetFromCron`), never stored beside
 * them, so the two cannot disagree — the property `cron.test.ts` pins from the
 * other side. Picking "custom" therefore changes nothing but opens the raw
 * fields; the selector keeps naming the preset the text still matches.
 */
export function ScheduleEditorModal({ job, jobName, onClose }: Props) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const update = useUpdateScheduledJob();
  const idBase = useId();

  const initialCron = jobCron(job) ?? EMPTY_CRON;
  const [fields, setFields] = useState<CronFields>(initialCron);
  const [timezone, setTimezone] = useState(job.timezone);
  const preset = presetFromCron(fields);
  const [advanced, setAdvanced] = useState(preset.kind === "custom");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const setPreset = (next: CronPreset) => {
    const written = cronFromPreset(next);
    if (written) setFields(written);
  };

  // `new Date()` inside the memo on purpose: the preview answers "from now",
  // and recomputing on every keystroke is what keeps "now" honest.
  const preview = useMemo(() => {
    try {
      return { runs: nextCronRuns(fields, timezone, new Date(), 3) };
    } catch {
      return { runs: null };
    }
  }, [fields, timezone]);

  const cronErrors = [
    ...(fieldErrors.cron ?? []),
    ...CRON_FIELDS.flatMap((name) => fieldErrors[name] ?? []),
  ];

  const save = async () => {
    const data: ScheduledJobUpdate = {};
    for (const name of CRON_FIELDS) {
      if (fields[name] !== initialCron[name]) data[name] = fields[name].trim();
    }
    if (timezone !== job.timezone) data.timezone = timezone;
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync({ id: job.id, data });
      showToast(t("scheduler.editor.saved"), "success");
      onClose();
    } catch (error) {
      const failure = classifySchedulerError(error);
      if (failure.kind === "invalid" && Object.keys(failure.fields).length > 0) {
        setFieldErrors(failure.fields);
        // A cron error is shown beside the raw fields, so they must be visible.
        if (failure.fields.cron || CRON_FIELDS.some((n) => failure.fields[n])) setAdvanced(true);
        return;
      }
      showToast(t("scheduler.editor.save_failed"), "error");
    }
  };

  const numberField = (label: string, value: number, min: number, max: number, apply: (n: number) => CronPreset) => (
    <TextField
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={String(value)}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= min && n <= max) setPreset(apply(n));
      }}
    />
  );

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose} disabled={update.isPending}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" form={`${idBase}-form`} variant="primary" loading={update.isPending}>
        {t("common.save")}
      </Button>
    </div>
  );

  return (
    <BaseModal isOpen onClose={onClose} title={t("scheduler.editor.title", { job: jobName })} footer={footer}>
      <form
        id={`${idBase}-form`}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <SelectField
          label={t("scheduler.editor.preset")}
          value={preset.kind}
          onChange={(e) => {
            const kind = e.target.value as CronPresetKind;
            if (kind === "custom") setAdvanced(true);
            else if (kind !== preset.kind) setPreset(PRESET_DEFAULTS[kind]);
          }}
          options={PRESET_KINDS.map((kind) => ({ value: kind, label: t(`scheduler.editor.presets.${kind}`) }))}
        />

        {preset.kind === "every_n_minutes" &&
          numberField(t("scheduler.editor.interval"), preset.interval, 1, 59, (interval) => ({ ...preset, interval }))}
        {(preset.kind === "daily" || preset.kind === "weekly") &&
          numberField(t("scheduler.editor.hour"), preset.hour, 0, 23, (hour) => ({ ...preset, hour }))}
        {(preset.kind === "hourly" || preset.kind === "daily" || preset.kind === "weekly") &&
          numberField(t("scheduler.editor.minute"), preset.minute, 0, 59, (minute) => ({ ...preset, minute }))}
        {preset.kind === "weekly" && (
          <SelectField
            label={t("scheduler.editor.weekday")}
            value={String(preset.weekday)}
            onChange={(e) => setPreset({ ...preset, weekday: Number(e.target.value) })}
            options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`scheduler.editor.weekdays.${d}`) }))}
          />
        )}

        <div>
          <button
            type="button"
            aria-expanded={advanced}
            aria-controls={`${idBase}-advanced`}
            onClick={() => setAdvanced((open) => !open)}
            className="text-sm text-[oklch(var(--color-accent-ink))] underline underline-offset-2"
          >
            {t("scheduler.editor.advanced")}
          </button>
          {advanced && (
            <fieldset id={`${idBase}-advanced`} className="mt-3">
              <legend className="text-xs text-[oklch(var(--color-ink-muted))] mb-2">{t("scheduler.editor.cron_hint")}</legend>
              {/* Three columns at phone width: five would leave ~56px per field at 393px, narrower than the uppercase labels. */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CRON_FIELDS.map((name) => (
                  <TextField
                    key={name}
                    label={t(`scheduler.editor.cron_fields.${name}`)}
                    value={fields[name]}
                    className="min-w-0"
                    aria-invalid={cronErrors.length > 0 || undefined}
                    onChange={(e) => {
                      setFields((current) => ({ ...current, [name]: e.target.value }));
                      setFieldErrors(({ cron: _cron, [name]: _field, ...rest }) => rest);
                    }}
                    size="sm"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                ))}
              </div>
              {cronErrors.length > 0 && (
                <p role="alert" className="mt-2 text-xs text-[oklch(var(--color-status-error))] break-words">
                  {cronErrors.join(" ")}
                </p>
              )}
            </fieldset>
          )}
        </div>

        <TimezoneSelect
          value={timezone}
          onChange={(tz) => {
            setTimezone(tz);
            setFieldErrors(({ timezone: _tz, ...rest }) => rest);
          }}
          error={fieldErrors.timezone?.join(" ") ?? null}
        />

        <section aria-live="polite" className="border-t border-[oklch(var(--color-hairline))] pt-3">
          <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-muted))] mb-2">
            {t("scheduler.editor.preview")} · {timezone}
          </h3>
          {preview.runs === null ? (
            <p className="text-sm text-[oklch(var(--color-status-warning))]">{t("scheduler.editor.preview_invalid")}</p>
          ) : preview.runs.length === 0 ? (
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("scheduler.editor.preview_none")}</p>
          ) : (
            <ol className="space-y-1 font-mono text-sm text-[oklch(var(--color-ink))]" data-testid="cron-preview">
              {preview.runs.map((run) => (
                <li key={run.getTime()}>
                  {formatDateTime(run, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}
                </li>
              ))}
            </ol>
          )}
        </section>
      </form>
    </BaseModal>
  );
}
