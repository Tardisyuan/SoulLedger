"use client";

import { useId, useState } from "react";
import {
  DATA_SCOPES,
  type DataScope,
  type DataScopeRule,
  type Role,
  type RoleDataScopeConfig,
} from "@soulledger/core/api";
import { ADMIN_ROLE_NAME } from "@soulledger/core/api/perm";
import { useAllOrganizations } from "@soulledger/core/hooks/useOrganizations";
import { useTenantNames } from "@soulledger/core/hooks/useTenants";
import { useDataScopeResources, useRoleDataScope, useSaveRoleDataScope } from "@soulledger/core/hooks/useRoleDataScope";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";
import { OrgTreeSelect } from "@/src/components/organizations/OrgTreeSelect";

const FOLLOW = "";

/**
 * 角色抽屉的「数据范围」区(设计 B6)。五选一 + 自定义机构 + 按业务覆盖。
 * ADMIN 角色恒为全部、不可改;只有无殿管理员能改,别人只读(后端同样拦)。
 */
export function RoleDataScopeSection({ role }: { role: Role }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { isTenantExempt } = usePermissions();
  const headingId = useId();
  const fixed = role.name === ADMIN_ROLE_NAME;
  const canEdit = !fixed && isTenantExempt;

  const config = useRoleDataScope(role.id, !fixed);
  const resources = useDataScopeResources(!fixed);
  const orgs = useAllOrganizations({ enabled: !fixed });
  const tenants = useTenantNames({ enabled: !fixed });
  const tenantNames = new Map((tenants.data ?? []).map((x) => [x.id, x.display_name || x.code]));
  const save = useSaveRoleDataScope();
  const [draft, setDraft] = useState<RoleDataScopeConfig | null>(null);
  const current = draft ?? config.data;

  const scopeLabel = (s: DataScope) => t(`permissions.datascope.scope.${s}`);
  const missingOrgs = (r: DataScopeRule) => r.scope === "DEFINE" && r.orgs.length === 0;

  const header = (
    <h3 id={headingId} className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
      {t("permissions.datascope.title")}
    </h3>
  );
  const ownNote = <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.datascope.own_always")}</p>;

  if (fixed) {
    return (
      <section aria-labelledby={headingId} className="space-y-2 border-t border-[oklch(var(--color-block))] pt-3">
        {header}
        <p className="text-sm text-[oklch(var(--color-ink))]">{t("permissions.datascope.admin_fixed")}</p>
        {ownNote}
      </section>
    );
  }
  if (config.isError) {
    return (
      <section aria-labelledby={headingId} className="space-y-2 border-t border-[oklch(var(--color-block))] pt-3">
        {header}
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">{t("permissions.datascope.load_error")}</p>
      </section>
    );
  }
  if (!current) {
    return (
      <section aria-labelledby={headingId} aria-busy="true" className="space-y-2 border-t border-[oklch(var(--color-block))] pt-3">
        {header}
      </section>
    );
  }

  const edit = (next: RoleDataScopeConfig) => setDraft(next);
  const overrideOf = (key: string) => current.overrides.find((o) => o.resource === key);
  const setOverride = (key: string, value: string) => {
    const rest = current.overrides.filter((o) => o.resource !== key);
    edit({
      ...current,
      overrides: value === FOLLOW ? rest : [...rest, { resource: key, scope: value as DataScope, orgs: overrideOf(key)?.orgs ?? [] }],
    });
  };
  const invalid = missingOrgs(current.default) || current.overrides.some(missingOrgs);
  const clean = (r: DataScopeRule): DataScopeRule => ({ scope: r.scope, orgs: r.scope === "DEFINE" ? r.orgs : [] });

  const submit = () => {
    if (invalid || !draft) return;
    save.mutate(
      {
        roleId: role.id,
        body: { default: clean(draft.default), overrides: draft.overrides.map((o) => ({ resource: o.resource, ...clean(o) })) },
      },
      {
        onSuccess: () => {
          setDraft(null);
          showToast(t("permissions.datascope.saved"), "success");
        },
        onError: () => showToast(t("permissions.datascope.save_error"), "error"),
      },
    );
  };

  const orgPicker = (rule: DataScopeRule, onChange: (ids: number[]) => void, label: string) => (
    <OrgTreeSelect
      mode="multi"
      label={label}
      organizations={orgs.data ?? []}
      tenantNames={tenantNames}
      value={rule.orgs}
      onChange={onChange}
      disabled={!canEdit}
      error={missingOrgs(rule) ? t("permissions.datascope.orgs_required") : undefined}
    />
  );

  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t border-[oklch(var(--color-block))] pt-3">
      {header}
      <fieldset disabled={!canEdit} className="space-y-1">
        <legend className="sr-only">{t("permissions.datascope.default")}</legend>
        {DATA_SCOPES.map((s) => (
          <label key={s} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${headingId}-default`}
              checked={current.default.scope === s}
              onChange={() => edit({ ...current, default: { ...current.default, scope: s } })}
            />
            {scopeLabel(s)}
          </label>
        ))}
      </fieldset>
      {current.default.scope === "DEFINE" &&
        orgPicker(current.default, (ids) => edit({ ...current, default: { ...current.default, orgs: ids } }), t("permissions.datascope.orgs"))}

      <details className="border-t border-[oklch(var(--color-rule))] pt-2">
        <summary className="cursor-pointer text-sm">{t("permissions.datascope.per_resource")}</summary>
        <div className="mt-2 space-y-3">
          {resources.isError && (
            <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">{t("permissions.datascope.load_error")}</p>
          )}
          {(resources.data ?? []).map((res) => {
            const o = overrideOf(res.key);
            return (
              <div key={res.key} className="space-y-2" data-resource={res.key}>
                <SelectField
                  id={`${headingId}-${res.key}`}
                  label={res.label}
                  value={o?.scope ?? FOLLOW}
                  disabled={!canEdit}
                  onChange={(e) => setOverride(res.key, e.target.value)}
                  options={[
                    { value: FOLLOW, label: t("permissions.datascope.follow_default") },
                    ...DATA_SCOPES.map((s) => ({ value: s, label: scopeLabel(s) })),
                  ]}
                />
                {o?.scope === "DEFINE" &&
                  orgPicker(
                    o,
                    (ids) => edit({ ...current, overrides: current.overrides.map((x) => (x.resource === res.key ? { ...x, orgs: ids } : x)) }),
                    t("permissions.datascope.orgs_for", { name: res.label }),
                  )}
              </div>
            );
          })}
        </div>
      </details>

      {ownNote}
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" loading={save.isPending} disabled={!draft || invalid} onClick={submit}>
            {t("permissions.datascope.save")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("permissions.datascope.read_only")}</p>
      )}
    </section>
  );
}
