"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantsApi, REBIRTH_COOLDOWN_SETTING, type Tenant, type TenantMfaRoleRow, type TenantSettingsPatch } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { userKeys } from "@soulledger/core/query_keys";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, TextField } from "@/src/components/ui/Field";

type FieldName = keyof TenantSettingsPatch;
const FIELDS: FieldName[] = ["hall_name", "hall_name_en", "hall_name_egy", "description", "dispatch_enabled", "soul_rebirth_cooldown_days", "mfa_required_roles"];

/** DRF 的 400 按字段给 `{field: [msg, …]}`;只认已知字段,每个摊平成一句。别的形状返回空表。 */
export function tenantSettingsErrors(error: unknown): Partial<Record<FieldName, string>> {
  const r = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (r?.status !== 400 || !r.data || typeof r.data !== "object") return {};
  const body = r.data as Record<string, unknown>;
  const out: Partial<Record<FieldName, string>> = {};
  for (const f of FIELDS) {
    const v = body[f];
    if (typeof v === "string") out[f] = v;
    else if (Array.isArray(v) && v.length) out[f] = v.map(String).join(" ");
  }
  return out;
}

/** 冷却天数的上限,与 `TenantSettingsSerializer` 的 `max_value` 同一个数。 */
export const COOLDOWN_DAYS_MAX = 365;

/** 输入框里的冷却天数 → 请求体:空 = `null`(删键,回默认);非整数、负数或超过 365 不出门,留给字段错误。 */
export function parseCooldownDays(value: string): number | null | undefined {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n > COOLDOWN_DAYS_MAX ? undefined : n;
}

/**
 * 殿的设置(ADMIN):三语殿司展示名、说明、调拨开关、转生冷却天数。
 * 调 `PATCH /tenants/{code}/settings/` —— 只发这几个已知字段;`settings` 里别的键(助手开关等)后端合并保留。
 * 400 的字段信息原样显示在各自字段下。
 */
export function TenantSettingsDialog({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const initialCooldown = tenant.settings?.[REBIRTH_COOLDOWN_SETTING];
  const [form, setForm] = useState({
    hall_name: tenant.hall_name ?? "",
    hall_name_en: tenant.hall_name_en ?? "",
    hall_name_egy: tenant.hall_name_egy ?? "",
    description: tenant.description ?? "",
    dispatch_enabled: Boolean(tenant.dispatch_enabled),
    cooldown: typeof initialCooldown === "number" ? String(initialCooldown) : "",
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  // 安全 · 两步验证(A12):每角色一行,开关写 `mfa_required_roles`。行从 /tenants/{code}/mfa-roles/ 来;
  // 没拉到就不发这个字段,免得把一份空清单写进去。
  const mfaRoles = useQuery({ queryKey: ["tenants", tenant.code, "mfa-roles"], queryFn: () => tenantsApi.mfaRoles(tenant.code).then((r) => r.data) });
  const [requiredRoles, setRequiredRoles] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (mfaRoles.data && requiredRoles === null) {
      setRequiredRoles(new Set(mfaRoles.data.filter((r) => r.required && !r.always).map((r) => r.role)));
    }
  }, [mfaRoles.data, requiredRoles]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k === "cooldown" ? "soul_rebirth_cooldown_days" : k]: undefined }));
  };

  const save = useMutation({
    mutationFn: (patch: TenantSettingsPatch) => tenantsApi.updateSettings(tenant.code, patch).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("tenants.settings.saved"), "success");
      onClose();
    },
    onError: (e) => {
      const fieldErrors = tenantSettingsErrors(e);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else showToast(t("tenants.settings.save_failed"), "error");
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const days = parseCooldownDays(form.cooldown);
    if (days === undefined) {
      setErrors({ soul_rebirth_cooldown_days: t("tenants.settings.cooldown_invalid") });
      return;
    }
    setErrors({});
    save.mutate({
      hall_name: form.hall_name.trim(),
      hall_name_en: form.hall_name_en.trim(),
      hall_name_egy: form.hall_name_egy.trim(),
      description: form.description.trim(),
      dispatch_enabled: form.dispatch_enabled,
      soul_rebirth_cooldown_days: days,
      ...(requiredRoles ? { mfa_required_roles: [...requiredRoles].sort() } : {}),
    });
  };

  return (
    <BaseModal
      isOpen
      onClose={() => !save.isPending && onClose()}
      title={t("tenants.settings.title", { name: tenant.display_name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="tenant-settings-form" variant="primary" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <form id="tenant-settings-form" className="space-y-4" onSubmit={submit}>
        <TextField
          label={t("tenants.settings.hall_name")}
          description={t("tenants.settings.hall_name_hint")}
          error={errors.hall_name}
          value={form.hall_name}
          onChange={(e) => set("hall_name", e.target.value)}
          maxLength={60}
          disabled={save.isPending}
        />
        <TextField
          label={t("tenants.settings.hall_name_en")}
          error={errors.hall_name_en}
          value={form.hall_name_en}
          onChange={(e) => set("hall_name_en", e.target.value)}
          maxLength={80}
          disabled={save.isPending}
        />
        <TextField
          label={t("tenants.settings.hall_name_egy")}
          error={errors.hall_name_egy}
          value={form.hall_name_egy}
          onChange={(e) => set("hall_name_egy", e.target.value)}
          maxLength={80}
          disabled={save.isPending}
        />
        <TextAreaField
          label={t("tenants.settings.description")}
          error={errors.description}
          rows={3}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          disabled={save.isPending}
        />
        <TextField
          label={t("tenants.settings.cooldown_days")}
          description={t("tenants.settings.cooldown_hint")}
          error={errors.soul_rebirth_cooldown_days}
          inputMode="numeric"
          value={form.cooldown}
          onChange={(e) => set("cooldown", e.target.value)}
          disabled={save.isPending}
        />
        <label className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink))]">
          <input
            type="checkbox"
            checked={form.dispatch_enabled}
            onChange={(e) => set("dispatch_enabled", e.target.checked)}
            disabled={save.isPending}
          />
          {t("tenants.settings.dispatch_enabled")}
        </label>
        {errors.dispatch_enabled ? (
          <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{errors.dispatch_enabled}</p>
        ) : null}

        {/* 安全 (A14 §4): the group sits at the bottom behind a 1px rule and its own title; a tab
            only when security settings reach two groups. */}
        <div className="flex flex-col gap-3 border-t border-[oklch(var(--color-block))] pt-6" data-testid="tenant-security">
        <h3 id="tenant-security-title" className="m-0 font-[family-name:var(--font-title)] text-lg text-[oklch(var(--color-ink))]">
          {t("tenants.settings.security")}
        </h3>
        <section aria-labelledby="tenant-mfa-roles-title" className="flex flex-col gap-2" data-testid="tenant-mfa-roles">
          <h4 id="tenant-mfa-roles-title" className="m-0 text-sm font-medium text-[oklch(var(--color-ink))]">{t("mfa.admin.roles_title")}</h4>
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("mfa.admin.roles_hint")}</p>
          {mfaRoles.isError ? (
            <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{t("mfa.admin.roles_load_failed")}</p>
          ) : null}
          {errors.mfa_required_roles ? (
            <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{errors.mfa_required_roles}</p>
          ) : null}
          <ul className="m-0 list-none divide-y divide-[oklch(var(--color-rule))] p-0">
            {(mfaRoles.data ?? []).map((row) => (
              <MfaRoleRow
                key={row.role}
                row={row}
                checked={row.always || (requiredRoles?.has(row.role) ?? row.required)}
                disabled={row.always || save.isPending || requiredRoles === null}
                onChange={(on) =>
                  setRequiredRoles((prev) => {
                    const next = new Set(prev ?? []);
                    if (on) next.add(row.role);
                    else next.delete(row.role);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </section>
        </div>
      </form>
    </BaseModal>
  );
}

/** 一行一个角色(56 高):角色名、「已开启/总数 · N 人待设置」、开关「要求/不要求」;ADMIN 写「始终」,开关禁用。 */
function MfaRoleRow({ row, checked, disabled, onChange }: { row: TenantMfaRoleRow; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const { t } = useI18n();
  const name = row.role in BUILTIN_ROLE_KEYS ? t(`users.roles.${row.role}`) : row.role;
  const pending = checked ? row.total - row.enabled : 0;
  return (
    <li className="flex min-h-14 items-center gap-3 py-2" data-role={row.role}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[oklch(var(--color-ink))]">{name}</p>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("mfa.admin.role_stat", { enabled: String(row.enabled), total: String(row.total), pending: String(pending) })}
        </p>
      </div>
      {row.always ? (
        <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("mfa.admin.always")}</span>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={`${name} · ${t(checked ? "mfa.admin.require" : "mfa.admin.not_require")}`}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className="flex h-11 items-center gap-2 text-xs text-[oklch(var(--color-ink))] disabled:cursor-not-allowed"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-[18px] w-8 items-center border-[1.5px] p-0.5 transition-colors duration-instant ${
              checked ? "justify-end bg-[oklch(var(--color-ink))] border-[oklch(var(--color-ink))]" : "justify-start bg-transparent border-[oklch(var(--color-line-strong))]"
            }`}
          >
            <span className={`block size-[11px] ${checked ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-line-strong))]"}`} />
          </span>
          {t(checked ? "mfa.admin.require" : "mfa.admin.not_require")}
        </button>
      )}
    </li>
  );
}

const BUILTIN_ROLE_KEYS: Record<string, true> = { ADMIN: true, MODERATOR: true, JUDGE: true, GUARDIAN: true, VIEWER: true };
