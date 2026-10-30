"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantsApi, REBIRTH_COOLDOWN_SETTING, REBIRTH_QUOTA_SETTING, SOUL_EMAIL_SELF_SERVICE_SETTING, VISIT_SETTING_LIMITS, type Tenant, type TenantMfaRoleRow, type TenantSettingsPatch } from "@soulledger/core/api";
import { tenantKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { SIX_PATHS } from "@/src/components/souls/RebirthFormSelect";
import { REBIRTH_QUOTA_KEY, useRebirthQuota } from "@/src/components/souls/RebirthQuota";
import { cn } from "@/lib/utils";
import { userKeys } from "@soulledger/core/query_keys";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, TextField, fieldControl } from "@/src/components/ui/Field";
import { MissingValue } from "@/src/components/ui/DomainValue";

type FieldName = keyof TenantSettingsPatch;
const FIELDS: FieldName[] = ["hall_name", "hall_name_en", "hall_name_egy", "description", "dispatch_enabled", "soul_rebirth_cooldown_days", "mfa_required_roles", "visit_address", "visit_hours", "visit_phone", "rebirth_monthly_quota"];

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
    // 配额是按道的字典,错误也按道给:`{HUMAN: ["…"]}` —— 摊平成一句。
    else if (v && typeof v === "object") out[f] = Object.values(v).flat().map(String).join(" ");
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

/** 转世配额的行(第五十一批 Q-1):六道按 `reincarnation.groups` 的顺序,再加「未归类」一行(后端也按它计数)。 */
export const QUOTA_FORMS = [...SIX_PATHS, "OTHER"] as const;
/** 与 `TenantSettingsSerializer.rebirth_monthly_quota` 的 `max_value` 同一个数。 */
export const QUOTA_MAX = 100000;

/** 输入框里的每月上限 → 请求体:空 = `null`(不限);0 或正整数照收;别的不出门。 */
export function parseQuotaLimit(value: string): number | null | undefined {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n > QUOTA_MAX ? undefined : n;
}

/** 殿 `settings` 里存的配额 → 每道一格输入框的初值(没设 = 空 = 不限)。 */
function initialQuota(tenant: Tenant): Record<string, string> {
  const raw = (tenant.settings?.[REBIRTH_QUOTA_SETTING] ?? {}) as Record<string, unknown>;
  return Object.fromEntries(QUOTA_FORMS.map((f) => [f, typeof raw[f] === "number" ? String(raw[f]) : ""]));
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
    visit_address: String(tenant.settings?.visit_address ?? ""),
    visit_hours: String(tenant.settings?.visit_hours ?? ""),
    visit_phone: String(tenant.settings?.visit_phone ?? ""),
    // 缺省 = 开:只有明确的 false 才是关(与后端 `self_service` 同一条规则)。
    soulEmailSelf: tenant.settings?.[SOUL_EMAIL_SELF_SERVICE_SETTING] !== false,
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  // 转世配额(第五十一批 Q-1):初值是这一殿 `settings` 里存的上限;「本月已办」取 `/reincarnation/quota/`,
  // 那个接口只答调用者自己的殿 —— 改的是别的殿时不画这一列,免得把自己殿的数写到别人名下。
  // 埃及冥府没有转世,整段不画,也不发这个字段。
  const { tenantCode } = useTenant();
  const hasRebirth = tenant.civilization !== "EGYPTIAN";
  const [quotaStart] = useState(() => initialQuota(tenant));
  const [quota, setQuota] = useState<Record<string, string>>(quotaStart);
  const ownHall = tenantCode === tenant.code;
  const quotaUsage = useRebirthQuota(hasRebirth && ownHall);
  const usedOf = (form: string) => quotaUsage.data?.find((r) => r.rebirth_form === form)?.used;
  // 安全 · 两步验证(A12):每角色一行,开关写 `mfa_required_roles`。行从 /tenants/{code}/mfa-roles/ 来;
  // 没拉到就不发这个字段,免得把一份空清单写进去。
  const mfaRoles = useQuery({ queryKey: tenantKeys.mfaRoles(tenant.code), queryFn: () => tenantsApi.mfaRoles(tenant.code).then((r) => r.data) });
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
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void queryClient.invalidateQueries({ queryKey: REBIRTH_QUOTA_KEY });
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
    const quotaPatch: Record<string, number | null> = {};
    for (const f of hasRebirth ? QUOTA_FORMS : []) {
      const next = parseQuotaLimit(quota[f]);
      if (next === undefined) {
        setErrors({ rebirth_monthly_quota: t("tenants.settings.rebirth_quota_invalid") });
        return;
      }
      if (next !== parseQuotaLimit(quotaStart[f])) quotaPatch[f] = next;
    }
    setErrors({});
    save.mutate({
      hall_name: form.hall_name.trim(),
      hall_name_en: form.hall_name_en.trim(),
      hall_name_egy: form.hall_name_egy.trim(),
      description: form.description.trim(),
      dispatch_enabled: form.dispatch_enabled,
      soul_rebirth_cooldown_days: days,
      visit_address: form.visit_address.trim(),
      visit_hours: form.visit_hours.trim(),
      visit_phone: form.visit_phone.trim(),
      soul_contact_email_self_service: form.soulEmailSelf,
      ...(requiredRoles ? { mfa_required_roles: [...requiredRoles].sort() } : {}),
      // 只发改过的道:没动的道不碰,后端按道合并。
      ...(Object.keys(quotaPatch).length ? { rebirth_monthly_quota: quotaPatch } : {}),
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

        {/* 转世配额 (第五十一批 Q-1):每道一行,道 / 每月上限 / 本月已办;跟整页一起保存。
            调到比已办还低不拦,旁边说一句;0 是「本月不办这一道」,也说一句。 */}
        {hasRebirth ? (
          <section className="flex flex-col gap-3 border-t border-[oklch(var(--color-block))] pt-6" data-testid="tenant-rebirth-quota">
            <h3 className="m-0 font-[family-name:var(--font-title)] text-lg text-[oklch(var(--color-ink))]">{t("tenants.settings.rebirth_quota_title")}</h3>
            <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("tenants.settings.rebirth_quota_body")}</p>
            {errors.rebirth_monthly_quota ? (
              <p role="alert" className="m-0 text-xs text-[oklch(var(--color-danger))]">{errors.rebirth_monthly_quota}</p>
            ) : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[oklch(var(--color-line))] text-left text-2xs text-[oklch(var(--color-ink-subtle))]">
                  <th scope="col" className="py-1 pr-2 font-normal">{t("rebirths.col_form")}</th>
                  <th scope="col" className="py-1 pr-2 font-normal">{t("tenants.settings.rebirth_quota_limit_col")}</th>
                  {ownHall ? <th scope="col" className="py-1 text-right font-normal">{t("tenants.settings.rebirth_quota_used_col")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {QUOTA_FORMS.map((form) => {
                  const limit = parseQuotaLimit(quota[form]);
                  const used = usedOf(form);
                  const note =
                    limit === undefined
                      ? t("tenants.settings.rebirth_quota_invalid")
                      : limit === 0
                        ? t("tenants.settings.rebirth_quota_zero")
                        : limit !== null && used !== undefined && limit < used
                          ? t("tenants.settings.rebirth_quota_below_used")
                          : null;
                  const label = t(`reincarnation.forms.${form}`);
                  return (
                    <tr key={form} data-quota-form={form} className="border-b border-[oklch(var(--color-rule))]">
                      <th scope="row" className="py-2 pr-2 text-left font-normal text-[oklch(var(--color-ink))]">{label}</th>
                      <td className="py-2 pr-2">
                        <input
                          inputMode="numeric"
                          aria-label={`${label} · ${t("tenants.settings.rebirth_quota_limit_col")}`}
                          aria-invalid={limit === undefined || undefined}
                          placeholder={t("tenants.settings.rebirth_quota_unlimited")}
                          value={quota[form]}
                          onChange={(e) => {
                            const value = e.target.value;
                            setQuota((q) => ({ ...q, [form]: value }));
                            setErrors((er) => ({ ...er, rebirth_monthly_quota: undefined }));
                          }}
                          disabled={save.isPending}
                          className={cn(fieldControl({ size: "sm", invalid: limit === undefined }), "w-24 font-mono tabular-nums")}
                        />
                        {note ? (
                          <span
                            data-quota-note=""
                            className={`mt-1 block text-2xs ${limit === undefined ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink-muted))]"}`}
                          >
                            {note}
                          </span>
                        ) : null}
                      </td>
                      {ownHall ? (
                        <td className="py-2 text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
                          {used ?? <MissingValue kind="unrecorded" />}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* 到殿办理 (第四十一批 H-a): 书信没开时灵魂 App 帮助页显示;三项选填,没填的不显示。 */}
        <section className="flex flex-col gap-3 border-t border-[oklch(var(--color-block))] pt-6" data-testid="tenant-visit">
          <h3 className="m-0 font-[family-name:var(--font-title)] text-lg text-[oklch(var(--color-ink))]">{t("hall_settings.visit.title")}</h3>
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("hall_settings.visit.hint")}</p>
          {tenant.letters_on ? (
            <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]" data-testid="tenant-visit-letters-on">{t("hall_settings.visit.letters_on")}</p>
          ) : null}
          {(
            [
              ["visit_address", "hall_settings.visit.address"],
              ["visit_hours", "hall_settings.visit.hours"],
              ["visit_phone", "hall_settings.visit.phone"],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={`${t(label)} · ${t("hall_settings.visit.optional")}`}
              error={errors[key]}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              maxLength={VISIT_SETTING_LIMITS[key]}
              disabled={save.isPending}
            />
          ))}
        </section>

        {/* 灵魂账号: 两行说明一直显示,不随开关切换。关开关只拦下新开始的改动,在途的照常完成。 */}
        <section className="flex flex-col gap-3 border-t border-[oklch(var(--color-block))] pt-6" data-testid="tenant-soul-accounts">
          <h3 className="m-0 font-[family-name:var(--font-title)] text-lg text-[oklch(var(--color-ink))]">{t("hall_settings.soul_accounts")}</h3>
          <label className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink))]">
            <input
              type="checkbox"
              checked={form.soulEmailSelf}
              onChange={(e) => set("soulEmailSelf", e.target.checked)}
              disabled={save.isPending}
            />
            {t("hall_settings.soul_email_self")}
          </label>
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("hall_settings.soul_email_on")}</p>
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("hall_settings.soul_email_off")}</p>
        </section>

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
