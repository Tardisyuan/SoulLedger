"use client";

import { useQuery } from "@tanstack/react-query";
import { realmsApi } from "@soulledger/core/api";
import type { SentencePlan, SentenceRequestChanges } from "@soulledger/core/api/sentence-plans";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { TenantName } from "./sentencePlanDisplay";

/*
 * 对受刑计划的一组加 / 减(`SentencePlanRequest.changes` 的形状),两处共用:
 * 灵魂不在本地时直接提的请求(情况 2.1 / 2.2),和加减项审判结案时带的改动(情况 1)。
 *
 * * 加:N2=(a) 只能加**本文明**的站 —— 所以这里只列本文明的界域,`tenant_code` 不发(服务端取提出方)。
 *   是否永久由界域决定(服务端抄),永久刑期只能排最后由服务端判(409 eternal_not_last)。
 * * 减:只有 PENDING 的站能减(§3.2),所以只列 PENDING。
 * 规则的权威在 backend/apps/sentence_plan/requests.py::normalize_changes;这里只挡明显填错的。
 */

export interface ChangesDraft {
  add: { realm_code: string; years: string; reason: string }[];
  remove: string[];
}

export const EMPTY_DRAFT: ChangesDraft = { add: [], remove: [] };

const yearsInvalid = (years: string) => years.trim() !== "" && !/^\d+$/.test(years.trim());

/** 草稿 → 请求体。`null` = 有一行没选界域或刑期不是非负整数,不能提交。 */
export function draftToChanges(draft: ChangesDraft): SentenceRequestChanges | null {
  if (draft.add.some((a) => !a.realm_code || yearsInvalid(a.years))) return null;
  const changes: SentenceRequestChanges = {};
  if (draft.add.length)
    changes.add = draft.add.map((a) => ({
      realm_code: a.realm_code,
      sentence_years: a.years.trim() === "" ? null : Number(a.years),
      reason: a.reason,
    }));
  if (draft.remove.length) changes.remove = draft.remove;
  return changes;
}

export const draftIsEmpty = (draft: ChangesDraft) => draft.add.length === 0 && draft.remove.length === 0;

export function PlanChangesEditor({
  plan,
  tenantCode,
  draft,
  onChange,
}: {
  plan: SentencePlan;
  /** The filing tenant: its realms are the only ones a stop can be added in. */
  tenantCode: string;
  draft: ChangesDraft;
  onChange: (next: ChangesDraft) => void;
}) {
  const { t } = useI18n();
  const civilization = TENANT_CODE_TO_CIVILIZATION[tenantCode];
  const realms = useQuery({
    queryKey: ["realms", "list", { civilization }],
    queryFn: () => realmsApi.list({ civilization }).then((r) => r.data.results),
    enabled: !!civilization,
  });
  const pending = plan.nodes.filter((n) => n.status === "PENDING");

  const setAdd = (index: number, patch: Partial<ChangesDraft["add"][number]>) =>
    onChange({ ...draft, add: draft.add.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  const toggleRemove = (id: string, on: boolean) =>
    onChange({ ...draft, remove: on ? [...draft.remove, id] : draft.remove.filter((r) => r !== id) });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium mb-1">{t("sentence_plan.file.add_title")}</legend>
        {draft.add.map((a, index) => {
          const eternal = realms.data?.find((r) => r.realm_code === a.realm_code)?.is_eternal;
          return (
            <div key={index} data-add-row={index} className="space-y-2 border-l-2 border-[oklch(var(--color-hairline))] pl-3">
              <p className="text-sm">
                <TenantName code={tenantCode} />
              </p>
              <SelectField
                label={t("sentence_plan.cross.realm")}
                value={a.realm_code}
                onChange={(e) => setAdd(index, { realm_code: e.target.value })}
                options={[
                  { value: "", label: t("sentence_plan.cross.realm_placeholder") },
                  ...(realms.data ?? []).map((r) => ({
                    value: r.realm_code,
                    label: resolveEnumDisplay(t, "realms.names", r.realm_code).label ?? r.realm_code,
                  })),
                ]}
              />
              {eternal && (
                <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("sentence_plan.cross.eternal_hint")}</p>
              )}
              <TextField
                label={t("sentence_plan.cross.years")}
                description={t("sentence_plan.cross.years_hint")}
                inputMode="numeric"
                value={a.years}
                onChange={(e) => setAdd(index, { years: e.target.value })}
                error={yearsInvalid(a.years) ? t("sentence_plan.cross.years_invalid") : undefined}
              />
              <TextField
                label={t("sentence_plan.file.reason")}
                value={a.reason}
                onChange={(e) => setAdd(index, { reason: e.target.value })}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange({ ...draft, add: draft.add.filter((_, i) => i !== index) })}
              >
                {t("sentence_plan.file.remove_row")}
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange({ ...draft, add: [...draft.add, { realm_code: "", years: "", reason: "" }] })}
        >
          {t("sentence_plan.file.add_stop")}
        </Button>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium mb-1">{t("sentence_plan.file.remove_title")}</legend>
        {pending.length === 0 ? (
          <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("sentence_plan.file.no_pending")}</p>
        ) : (
          pending.map((n) => (
            <label key={n.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={draft.remove.includes(n.id)}
                onChange={(e) => toggleRemove(n.id, e.target.checked)}
                className="h-4 w-4 accent-[oklch(var(--color-accent))]"
              />
              <span>{t("sentence_plan.stop", { order: String(n.order) })}</span>
              <TenantName code={n.tenant_code} />
              <span className="text-xs text-[oklch(var(--color-ink-subtle))]">
                <DomainEnum namespace="realms.names" value={n.realm_code || null} />
              </span>
            </label>
          ))
        )}
      </fieldset>
    </div>
  );
}
