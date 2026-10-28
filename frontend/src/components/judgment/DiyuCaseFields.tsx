"use client";

import { useId, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, wangsiApi, WANGSI_ERROR_CODES, type Judgment } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import {
  GRIEVANCE_LEVELS,
  GRIEVANCE_RELEASE_LEVELS,
  OFFENCES_BY_COURT,
  WRONGFUL_DEATH_CAUSES,
  offenceCourt,
} from "@soulledger/core/domain/diyuCase";
import { isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { fieldControl } from "@/src/components/ui/Field";

/*
 * 地府案子在审判台「资料舱 · 供词」一栏顶上的两块(2026-10-28,临时版式,等 Design 定稿):
 *  - 罪目:按殿分组的下拉;选了之后说明判有罪时去哪一殿,没选说明退回按严重度。
 *  - 枉死城:只在枉死的案子上。死因、冤情等级两个下拉;冤情申诉(提出 → 属实 / 不属实)。
 * 未结案且持 `judgment.execute` 才可改,其余只读。
 */

const LABEL = "text-2xs uppercase text-[oklch(var(--color-ink-subtle))]";
const HINT = "mt-1 text-xs text-[oklch(var(--color-ink-muted))]";

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
}

function refusalCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

export function OffenceField({ judgment, editable }: { judgment: Judgment; editable: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const refresh = useRefresh();
  const fieldId = useId();
  const value = judgment.offence ?? "";
  const save = useMutation({
    mutationFn: (offence: Judgment["offence"]) => judgmentApi.update(judgment.id, { offence }),
    onSuccess: refresh,
    onError: () => showToast(t("common.error"), "error"),
  });
  const court = offenceCourt(value);
  return (
    <div className="mb-4" data-testid="desk-offence">
      <label htmlFor={fieldId} className={LABEL}>{t("judgment.offence_field.label")}</label>
      {editable ? (
        <select
          id={fieldId}
          value={value}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.value as Judgment["offence"])}
          className={fieldControl({ size: "sm" })}
        >
          <option value="">{t("judgment.offence_field.none")}</option>
          {OFFENCES_BY_COURT.map((group) => (
            <optgroup key={group.court} label={t(`workflow.court.court_${group.court}`)}>
              {group.offences.map((o) => (
                <option key={o} value={o}>{t(`judgment.offences.${o}`)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <p className="mt-1 text-sm text-[oklch(var(--color-ink))]">
          {value ? <DomainEnum namespace="judgment.offences" value={value} /> : t("judgment.offence_field.none")}
        </p>
      )}
      {!judgment.is_final && (
        <p className={HINT}>
          {court
            ? t("judgment.offence_field.routes_to", { court: t(`workflow.court.court_${court}`) })
            : t("judgment.offence_field.fallback")}
        </p>
      )}
    </div>
  );
}

export function WangsiPanel({ judgment, editable }: { judgment: Judgment; editable: boolean }) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const refresh = useRefresh();
  const causeId = useId();
  const levelId = useId();
  const [plea, setPlea] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const held = isHeldUntilFatedDate(judgment);
  const status = judgment.grievance_status ?? "";

  const onRefused = (err: unknown) => {
    const code = refusalCode(err);
    setError(code && (WANGSI_ERROR_CODES as readonly string[]).includes(code) ? t(`judgment.wangsi.error.${code}`) : t("common.error"));
  };
  const patch = useMutation({
    mutationFn: (data: Parameters<typeof judgmentApi.update>[1]) => judgmentApi.update(judgment.id, data),
    onSuccess: refresh,
    onError: () => showToast(t("common.error"), "error"),
  });
  const file = useMutation({
    mutationFn: () => wangsiApi.fileGrievance(judgment.id, plea.trim()),
    onSuccess: () => { setPlea(""); setError(null); void refresh(); },
    onError: onRefused,
  });
  const decide = useMutation({
    mutationFn: (upheld: boolean) => wangsiApi.decideGrievance(judgment.id, upheld, note.trim()),
    onSuccess: () => { setNote(""); setError(null); void refresh(); },
    onError: onRefused,
  });

  const select = (id: string, label: string, value: string, members: readonly string[], ns: string,
    field: "wrongful_death_cause" | "grievance_level", shown: ReactNode) => (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      {editable ? (
        <select
          id={id}
          value={value}
          disabled={patch.isPending}
          onChange={(e) => patch.mutate({ [field]: e.target.value } as Parameters<typeof judgmentApi.update>[1])}
          className={fieldControl({ size: "sm" })}
        >
          <option value="">{t("judgment.wangsi.unset")}</option>
          {members.map((m) => <option key={m} value={m}>{t(`${ns}.${m}`)}</option>)}
        </select>
      ) : (
        <p className="mt-1 text-sm text-[oklch(var(--color-ink))]">
          {value ? shown : t("judgment.wangsi.unset")}
        </p>
      )}
    </div>
  );

  return (
    <section className="mb-4 border-l-2 border-[oklch(var(--color-line))] pl-3" data-testid="desk-wangsi" aria-label={t("judgment.wangsi.title")}>
      <p className="text-sm font-medium text-[oklch(var(--color-ink))]">{t("judgment.wangsi.title")}</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {select(causeId, t("judgment.wangsi.cause"), judgment.wrongful_death_cause ?? "", WRONGFUL_DEATH_CAUSES,
          "judgment.wrongful_death_causes", "wrongful_death_cause",
          <DomainEnum namespace="judgment.wrongful_death_causes" value={judgment.wrongful_death_cause} />)}
        {select(levelId, t("judgment.wangsi.level"), judgment.grievance_level ?? "", GRIEVANCE_LEVELS,
          "judgment.grievance_levels", "grievance_level",
          <DomainEnum namespace="judgment.grievance_levels" value={judgment.grievance_level} />)}
      </div>

      <div className="mt-3">
        <p className={LABEL}>{t("judgment.wangsi.grievance")}</p>
        {status && (
          <div className="mt-1 text-sm text-[oklch(var(--color-ink))]" data-testid="wangsi-grievance-status">
            <DomainEnum namespace="judgment.grievance_statuses" value={status} />
            {judgment.grievance_decided_at && ` · ${t("judgment.wangsi.decided_line", { date: formatDateTime(judgment.grievance_decided_at) })}`}
            {judgment.grievance_plea && <p className="mt-1 whitespace-pre-wrap">{judgment.grievance_plea}</p>}
            {judgment.grievance_note && <p className="mt-1 whitespace-pre-wrap text-[oklch(var(--color-ink-muted))]">{judgment.grievance_note}</p>}
          </div>
        )}
        {editable && held && (status === "" || status === "REJECTED") && (
          <div className="mt-2 space-y-2">
            <textarea
              aria-label={t("judgment.wangsi.plea")}
              value={plea}
              onChange={(e) => setPlea(e.target.value)}
              rows={3}
              maxLength={2000}
              className={fieldControl({ size: "sm" })}
            />
            <p className={HINT}>{t("judgment.wangsi.plea_hint")}</p>
            <Button type="button" size="sm" variant="secondary" data-testid="wangsi-file" disabled={!plea.trim()} loading={file.isPending} onClick={() => file.mutate()}>
              {t("judgment.wangsi.file")}
            </Button>
          </div>
        )}
        {editable && held && status === "FILED" && (
          <div className="mt-2 space-y-2">
            <textarea
              aria-label={t("judgment.wangsi.decision_note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className={fieldControl({ size: "sm" })}
            />
            <p className={HINT}>{t("judgment.wangsi.uphold_hint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                data-testid="wangsi-uphold"
                disabled={!note.trim() || !GRIEVANCE_RELEASE_LEVELS.includes(judgment.grievance_level ?? "")}
                loading={decide.isPending}
                onClick={() => decide.mutate(true)}
              >
                {t("judgment.wangsi.uphold")}
              </Button>
              <Button type="button" size="sm" variant="secondary" data-testid="wangsi-reject" disabled={!note.trim()} loading={decide.isPending} onClick={() => decide.mutate(false)}>
                {t("judgment.wangsi.reject")}
              </Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-xs text-[oklch(var(--color-danger))]">{error}</p>}
      </div>
    </section>
  );
}
