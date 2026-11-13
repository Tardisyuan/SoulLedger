"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useCreateSoul } from "@soulledger/core/hooks/useSouls";
import { localDateString } from "@soulledger/core/domain/dates";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import {
  CIVILIZATION_OPTIONS,
  TENANT_CODE_TO_CIVILIZATION,
  type CivilizationOption,
} from "@soulledger/core/config/civilizations";
import { soulCreateSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";
import type { SoulOriginRegion } from "@soulledger/core/api";
import { OriginRegionField } from "@/src/components/souls/OriginRegion";
import { problemErrors, responseStatus } from "@soulledger/core/api/client";

const SOUL_CREATE_FIELDS = ["name", "civilization", "birth_date", "origin_location"] as const;
type SoulCreateField = (typeof SOUL_CREATE_FIELDS)[number];

/**
 * 400 校验问题的 `errors`。这张表单画得出来的字段落到字段下,其余(`origin_region`、整份的)
 * 归到 `general`。不是校验问题时两边都空:`useCreateSoul` 已经报过了。
 */
function soulCreateErrorsOf(error: unknown): { fields: Partial<Record<SoulCreateField, string>>; general?: string } {
  const out: ReturnType<typeof soulCreateErrorsOf> = { fields: {} };
  if (responseStatus(error) !== 400) return out;
  for (const e of problemErrors(error)) {
    const key = e.field ?? "";
    if ((SOUL_CREATE_FIELDS as readonly string[]).includes(key)) out.fields[key as SoulCreateField] ??= e.detail;
    else out.general ??= e.detail;
  }
  return out;
}

interface SoulCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function SoulCreateModal({ isOpen, onClose, onCreated }: SoulCreateModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { validate, getError, clearFieldError } = useFormValidation(soulCreateSchema);
  // `useCreateSoul`, not `soulsApi.create`. This called the API client
  // directly, so **nothing invalidated the souls cache on create**: the list
  // only appeared to update because `onCreated` calls `refetch()` on the
  // calling page's exact query, leaving every other cached souls list — every
  // other filter, sort and page — stale for its full 30s staleTime. The page
  // even declared `useCreateSoul()` and never used it.
  const createSoul = useCreateSoul();

  // Unique prefix so field/error ids never collide across multiple Modal
  // instances mounted at once (e.g. list + create modal on the same page).
  //
  // The two `-error` ids that used to sit beside these are gone, not lost:
  // `Field` derives `${controlId}-error` itself and points `aria-describedby`
  // at it, so the ids that reach the DOM are byte-for-byte the ones this file
  // used to spell out. A second copy here would be a value nothing re-derives.
  const formId = useId();
  const nameId = `${formId}-name`;
  const civilizationId = `${formId}-civilization`;
  const birthDateId = `${formId}-birth-date`;
  const locationId = `${formId}-location`;
  const regionId = `${formId}-origin-region`;

  const [name, setName] = useState("");
  const [originRegion, setOriginRegion] = useState<SoulOriginRegion>("");
  const [civilization, setCivilization] = useState<CivilizationOption>("CHINESE");
  // 绑了殿的账号建到自己的殿,没有可选的文明,也不发这个字段;只有未绑殿的全局管理员选。
  const ownTenantCode = useTenant().user?.tenant?.code;
  const isBound = !!ownTenantCode;
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<SoulCreateField, string>>>({});
  const clearServerError = (field: SoulCreateField) => setServerErrors(({ [field]: _drop, ...rest }) => rest);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setCivilization("CHINESE");
      setBirthDate("");
      setOriginLocation("");
      setOriginRegion("");
      setServerErrors({});
    }
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const formData = {
      name: name.trim(),
      ...(isBound ? {} : { civilization }),
      birth_date: birthDate || null,
      // 模型是 `CharField(blank=True)`,不收 null:留空发 ""。发 null 时这个选填项留空必定 400。
      origin_location: originLocation,
      origin_region: originRegion,
    };

    const result = validate(formData);
    if (!result.success) {
      return;
    }

    setServerErrors({});
    setLoading(true);
    try {
      if (!result.data) {
        showToast(t("souls.form.create_error"), "error");
        setLoading(false);
        return
      }
      // No toast here: `useCreateSoul` owns both the success and failure
      // message. Toasting again would show two identical banners for one
      // create, which is what the edit path did until this commit.
      await createSoul.mutateAsync(result.data);
      onCreated();
      onClose();
    } catch (error) {
      // The hook toasts every failure except a 400 with an object body, which is
      // this form's to draw. Leaving the modal open is the recovery.
      const { fields, general } = soulCreateErrorsOf(error);
      setServerErrors(fields);
      if (general) showToast(general, "error");
    } finally {
      setLoading(false);
    }
  }

  /**
   * `Button`, not two more spellings of it.
   *
   * The submit button was one of ~15 sites that re-typed `Button`'s primary
   * recipe by hand, and the copies had already drifted apart: `px-4 py-2`
   * against the primitive's `px-3 py-2`, and `disabled:bg-surface-3
   * disabled:text-ink-subtle` against its `disabled:opacity-50
   * disabled:pointer-events-none`. Neither difference was ever a decision —
   * `ConfirmDialog` at the bottom of this same file had already moved.
   *
   * `loading` replaces the hand-rolled `<svg className="animate-spin">`:
   * `Button` renders an unlabelled `<Spinner size="sm">` and sets `aria-busy`,
   * which the inline SVG never did. It also disables the control, which is why
   * `disabled` no longer repeats `loading ||`.
   */
  // 按钮右对齐(规范 v1 §3.3),取消是幽按钮。
  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        onClick={onClose}
        disabled={loading}
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        form="soul-create-form"
        variant="primary"
        loading={loading}
        disabled={!name.trim()}
      >
        {loading ? t("souls.form.submitting") : t("souls.form.submit")}
      </Button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("souls.create")}
      footer={footer}
    >
      {/* `TextField` / `SelectField`, not four hand-wired label+control+error
          triples. `Field.tsx:22-28` names *these two controls* as the reason it
          exists: they were the only two form controls in the whole application
          that rendered a field-level error at all, and both painted it with the
          `red-500` palette literal rather than `--color-status-error` — which is
          re-measured per theme (`0 84% 62%` dark, `0 78% 44%` light, the light
          one darker specifically so error text clears AA on a light canvas).
          `red-500` follows neither, so light mode got the dark-mode reading. The
          primitive was written for this file and this file had never imported
          it. The `focus:` → `focus-visible:` switch comes with it, for the
          reason `Field.tsx:32-44` records: a mouse click into a text input still
          matches `:focus-visible`, a mouse click on a `<select>` stops matching
          — and the select is where the repainted border was noise. */}
      <form id="soul-create-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          id={nameId}
          label={t("souls.form.name_label")}
          type="text"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            clearFieldError('name')
            clearServerError('name')
          }}
          disabled={loading}
          error={getError('name') ?? serverErrors.name}
          placeholder={t("souls.form.name_placeholder")}
        />
        {!isBound && (
          <SelectField
            id={civilizationId}
            label={t("souls.form.civilization_label")}
            value={civilization}
            onChange={(e) => {
              setCivilization(e.target.value as typeof civilization)
              clearFieldError('civilization')
              clearServerError('civilization')
            }}
            disabled={loading}
            error={getError('civilization') ?? serverErrors.civilization}
            options={CIVILIZATION_OPTIONS.map((civ) => ({
              value: civ,
              label: t(`souls.civilizations.${civ}`),
            }))}
          />
        )}
        <TextField
          id={birthDateId}
          label={t("souls.form.birth_date_label")}
          type="date"
          value={birthDate}
          onChange={(e) => {
            setBirthDate(e.target.value)
            clearFieldError('birth_date')
            clearServerError('birth_date')
          }}
          disabled={loading}
          max={localDateString()}
          error={getError('birth_date') ?? serverErrors.birth_date}
        />
        {/* 籍贯(自由文本)与出身地域(归类)同一行(Design W-1)。 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <TextField
            id={locationId}
            label={t("souls.form.location_label")}
            type="text"
            value={originLocation}
            onChange={(e) => {
              setOriginLocation(e.target.value)
              clearFieldError('origin_location')
              clearServerError('origin_location')
            }}
            disabled={loading}
            error={getError('origin_location') ?? serverErrors.origin_location}
            placeholder={t("souls.form.location_placeholder")}
          />
          <OriginRegionField
            id={regionId}
            value={originRegion}
            onChange={setOriginRegion}
            disabled={loading}
            civilization={isBound ? TENANT_CODE_TO_CIVILIZATION[ownTenantCode ?? ""] : civilization}
          />
        </div>
      </form>
    </BaseModal>
  );
}
