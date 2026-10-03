"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tenantsApi, REBIRTH_COOLDOWN_SETTING, type Tenant, type TenantSettingsPatch } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, TextField } from "@/src/components/ui/Field";

type FieldName = keyof TenantSettingsPatch;
const FIELDS: FieldName[] = ["hall_name", "hall_name_en", "hall_name_egy", "description", "dispatch_enabled", "soul_rebirth_cooldown_days"];

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

/** 输入框里的冷却天数 → 请求体:空 = `null`(删键,回默认);非整数或负数不出门,留给字段错误。 */
export function parseCooldownDays(value: string): number | null | undefined {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  return Number(s);
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
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k === "cooldown" ? "soul_rebirth_cooldown_days" : k]: undefined }));
  };

  const save = useMutation({
    mutationFn: (patch: TenantSettingsPatch) => tenantsApi.updateSettings(tenant.code, patch).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
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
      </form>
    </BaseModal>
  );
}
