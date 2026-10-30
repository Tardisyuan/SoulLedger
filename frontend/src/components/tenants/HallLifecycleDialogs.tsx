"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tenantsApi, type Tenant, type TenantCreateBody } from "@soulledger/core/api";
import { tenantKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/src/components/ui/Field";

/** 与后端 `Civilization` 同四个;顺序同 `tenant.civilizations`。 */
export const HALL_CIVILIZATIONS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"] as const;

type Translate = (key: string, params?: Record<string, string>) => string;
type FieldErrors = Partial<Record<"code" | "civilization", string>>;

/**
 * `POST /tenants/` 的 400 → 各字段下的一句话。后端的句子是英文固定句式(`TenantCreateSerializer`),这里只认形状:
 * 代号已占用(`already exists`)、其余代号错误一律「格式不对」;文明错误是「`<code>` is a `<CIV>` hall.」,
 * 挂在文明下面(第五十四批 K-2:要改的通常是文明)。认不出的返回 null,调用方给通用提示。
 */
export function hallCreateErrors(error: unknown, code: string, t: Translate): FieldErrors | null {
  const res = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (res?.status !== 400 || !res.data || typeof res.data !== "object") return null;
  const body = res.data as Record<string, unknown>;
  const first = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "");
  const out: FieldErrors = {};
  if ("code" in body) {
    out.code = /already exists/i.test(first(body.code)) ? t("halls.code_taken") : t("halls.code_invalid");
  }
  if ("civilization" in body) {
    const civ = /\bis an? ([A-Z]+) hall/.exec(first(body.civilization))?.[1];
    out.civilization = civ ? t("halls.civ_mismatch", { code, civ: t(`tenant.civilizations.${civ}`) }) : first(body.civilization);
  }
  return Object.keys(out).length ? out : null;
}

/** 新建殿(K-2):代号、文明(四选一,必填,没有默认值)、名称、三语叫法一行、说明。 */
export function CreateHallDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TenantCreateBody>({ code: "", display_name: "", civilization: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (key: keyof TenantCreateBody) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (key === "code" || key === "civilization") setErrors({});
  };

  const create = useMutation({
    mutationFn: () => tenantsApi.create(form).then((r) => r.data),
    onSuccess: (hall) => {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      showToast(t("halls.created_toast", { name: hall.display_name }), "success");
      onClose();
    },
    onError: (e) => {
      const fieldErrors = hallCreateErrors(e, form.code, t);
      if (fieldErrors) setErrors(fieldErrors);
      else showToast(t("halls.create_failed"), "error");
    },
  });

  return (
    <BaseModal
      isOpen
      onClose={() => !create.isPending && onClose()}
      title={t("halls.create_title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="create-hall-form"
            variant="primary"
            loading={create.isPending}
            disabled={!form.code || !form.civilization || !form.display_name.trim()}
          >
            {t("halls.submit")}
          </Button>
        </div>
      }
    >
      <form
        id="create-hall-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          create.mutate();
        }}
      >
        <TextField
          label={t("halls.code")}
          description={t("halls.code_hint")}
          error={errors.code}
          value={form.code}
          onChange={(e) => set("code")({ target: { value: e.target.value.toUpperCase() } })}
          required
          pattern="[A-Z][A-Z0-9_]{1,49}"
          maxLength={50}
          autoComplete="off"
          spellCheck={false}
          mono
        />
        <SelectField
          label={t("halls.civilization")}
          error={errors.civilization}
          value={form.civilization}
          onChange={set("civilization")}
          required
          options={[
            { value: "", label: t("halls.civilization_pick"), disabled: true },
            ...HALL_CIVILIZATIONS.map((c) => ({ value: c, label: t(`tenant.civilizations.${c}`) })),
          ]}
        />
        <TextField label={t("halls.name")} value={form.display_name} onChange={set("display_name")} required maxLength={200} />
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-sm text-[oklch(var(--color-ink))]">{t("halls.hall_names")}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TextField label={t("tenants.settings.hall_name")} value={form.hall_name ?? ""} onChange={set("hall_name")} size="sm" />
            <TextField label={t("tenants.settings.hall_name_en")} value={form.hall_name_en ?? ""} onChange={set("hall_name_en")} size="sm" />
            <TextField
              label={t("tenants.settings.hall_name_egy")}
              description={t("halls.hall_names_hint")}
              value={form.hall_name_egy ?? ""}
              onChange={set("hall_name_egy")}
              size="sm"
            />
          </div>
        </fieldset>
        <TextAreaField label={t("halls.description_optional")} value={form.description ?? ""} onChange={set("description")} rows={2} />
      </form>
    </BaseModal>
  );
}

/**
 * 停用确认(K-3):不用危险色 —— 可逆、不删数据。两条后果分行写,第二条点明「重试也一样」;末句「殿不能删除」。
 */
export function DeactivateHallDialog({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { t } = useI18n();
  const deactivate = useHallActiveMutation(onClose);
  return (
    <BaseModal
      isOpen
      onClose={() => !deactivate.isPending && onClose()}
      title={t("halls.deactivate_title", { name: tenant.display_name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={deactivate.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={deactivate.isPending}
            data-testid="hall-deactivate-confirm"
            onClick={() => deactivate.mutate({ tenant, active: false })}
          >
            {t("halls.deactivate")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-[oklch(var(--color-ink))]">
        <p className="m-0">{t("halls.deactivate_body")}</p>
        <ul className="m-0 list-disc pl-6">
          <li>{t("halls.deactivate_no_souls")}</li>
          <li>{t("halls.deactivate_no_deaths")}</li>
        </ul>
        <p className="m-0 text-[oklch(var(--color-ink-muted))]">{t("halls.deactivate_reversible")}</p>
      </div>
    </BaseModal>
  );
}

/** 停用 / 重新启用共用:成功刷新殿列表与概况并 toast;失败 toast,不关弹层。 */
export function useHallActiveMutation(onDone?: () => void) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenant, active }: { tenant: Tenant; active: boolean }) =>
      (active ? tenantsApi.activate(tenant.code) : tenantsApi.deactivate(tenant.code)).then((r) => r.data),
    onSuccess: (hall, { active }) => {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      showToast(t(active ? "halls.activated_toast" : "halls.deactivated_toast", { name: hall.display_name }), "success");
      onDone?.();
    },
    onError: () => showToast(t("halls.action_failed"), "error"),
  });
}
