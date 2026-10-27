"use client";

import { useState, useEffect, useId } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { useI18n } from "@/src/contexts/I18nContext";
import { useUpdateSoul } from "@soulledger/core/hooks/useSouls";
import type { Soul, SoulBaptism, SoulDuatPassage, SoulOriginRegion } from "@soulledger/core/api";
import { OriginRegionField } from "@/src/components/souls/OriginRegion";
import { soulUpdateSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";
import { type HistoricalDate } from "@/lib/utils";

interface SoulEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  soul: Soul;
  onUpdated: () => void;
}

const STATE_OPTION_VALUES = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "LOST"] as const;

export function SoulEditModal({ isOpen, onClose, soul, onUpdated }: SoulEditModalProps) {
  const { t } = useI18n();
  const updateMutation = useUpdateSoul();
  const { validate, getError, clearFieldError } = useFormValidation(soulUpdateSchema);

  // Unique prefix so field/error ids never collide across multiple
  // SoulEditModal instances mounted at once. The `-error` id is no longer
  // spelled out here: `Field` derives `${controlId}-error` and wires
  // `aria-describedby` to it, producing the same string this file used to.
  const formId = useId();
  const nameId = `${formId}-name`;
  const birthDateId = `${formId}-birth-date`;
  const deathDateId = `${formId}-death-date`;
  const fatedDateId = `${formId}-fated-death-date`;
  const locationId = `${formId}-location`;
  const stateId = `${formId}-state`;
  const regionId = `${formId}-origin-region`;
  const duatId = `${formId}-duat-passage`;
  const baptismId = `${formId}-baptism`;
  const deniedId = `${formId}-denied-immortality`;

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [deathDate, setDeathDate] = useState("");
  const [fatedDate, setFatedDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [originRegion, setOriginRegion] = useState<SoulOriginRegion>("");
  const [duatPassage, setDuatPassage] = useState<SoulDuatPassage>("");
  const [baptism, setBaptism] = useState<SoulBaptism>("UNRECORDED");
  const [deniedImmortality, setDeniedImmortality] = useState<boolean | null>(null);
  const [currentState, setCurrentState] = useState<Soul["current_state"]>("ALIVE");

  // SETTLED is terminal to an operator — its one way out (back to DISPOSED
  // when a cross-realm judgment reopens a finished sentence plan) is the
  // server's, not a pick here; not even LOST — so an operator must not be
  // able to pick it manually. The control is
  // disabled rather than removed: `currentState` still holds "SETTLED" and
  // round-trips on submit instead of silently reverting to the default.
  const isSettled = soul.current_state === "SETTLED";
  // 阳寿(第五十一批 F-1):只有地府登记;别的文明连字段一起不画,也不发。
  const hasFatedDate = soul.civilization === "CHINESE";
  // 入殿前情形(review P2-9):只有埃及登记,同阳寿一样别的文明不画、不发。
  const hasDuatPassage = soul.civilization === "EGYPTIAN";
  // 受洗与否认灵魂不灭(review E-2):只有欧洲登记 —— 第一圈 Limbo 与第六圈读它们,别的文明不画、不发。
  const hasInfernoFacts = soul.civilization === "EUROPEAN";

  // Convert HistoricalDate to HTML date input format (YYYY-MM-DD)
  const historicalDateToInputValue = (date: HistoricalDate | null | undefined): string => {
    if (!date || !date.month || !date.day) return "";
    const year = Math.abs(date.year).toString().padStart(4, "0");
    const month = date.month.toString().padStart(2, "0");
    const day = date.day.toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Populate form when soul changes or modal opens
  useEffect(() => {
    if (isOpen && soul) {
      setName(soul.name || "");
      setBirthDate(historicalDateToInputValue(soul.birth_date));
      setDeathDate(historicalDateToInputValue(soul.death_date));
      setFatedDate(historicalDateToInputValue(soul.fated_death_date));
      setOriginLocation(soul.origin_location || "");
      setOriginRegion(soul.origin_region ?? "");
      setDuatPassage(soul.duat_passage ?? "");
      setBaptism(soul.baptism ?? "UNRECORDED");
      setDeniedImmortality(soul.denied_immortality ?? null);
      setCurrentState(soul.current_state || "ALIVE");
    }
  }, [isOpen, soul]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const formData = {
      name: name.trim(),
      birth_date: birthDate || null,
      // 死亡与阳寿只在改过时才发:输入框装不下只有年份的日期(显示为空),原样不动就不该把它清掉。
      ...(deathDate !== historicalDateToInputValue(soul.death_date) ? { death_date: deathDate || null } : {}),
      ...(hasFatedDate && fatedDate !== historicalDateToInputValue(soul.fated_death_date)
        ? { fated_death_date: fatedDate || null }
        : {}),
      origin_location: originLocation || undefined,
      origin_region: originRegion,
      ...(hasDuatPassage ? { duat_passage: duatPassage } : {}),
      ...(hasInfernoFacts ? { baptism, denied_immortality: deniedImmortality } : {}),
      current_state: currentState,
    };

    const result = validate(formData);
    if (!result.success || !result.data) {
      return;
    }

    updateMutation.mutate(
      {
        id: soul.id,
        data: result.data,
      },
      {
        // No toasts here. `useUpdateSoul` already toasts on both outcomes, so
        // every soul edit raised TWO banners — `souls.form.update_success`
        // from this callback and the hook's own, which are the same sentence.
        // The callbacks stay: closing the modal is this component's job, not
        // the hook's.
        onSuccess: () => {
          onUpdated();
          onClose();
        },
      }
    );
  }

  /**
   * SAVE WAS PAINTED `bg-amber-500`, AND THAT LOOKED FINE, WHICH IS THE POINT.
   *
   * Tailwind's `amber-500` is `#f59e0b` = `hsl(38 92% 50%)`, and
   * `app/globals.css:322` declares `--color-accent: 38 92% 50%` — byte for
   * byte the same colour in both themes today. So no screenshot, no contrast
   * check and no reviewer could see anything wrong with it.
   *
   * What made it a defect is `app/globals.css:334`: `--color-accent` is
   * **configurable by the operator at runtime**. The moment anyone picks
   * another accent, every primary button in the product follows it and this
   * one save button — plus `UserModal`'s, the other copy — stays amber. Two
   * save buttons in two modals, different colours, and nothing anywhere goes
   * red: a palette literal cannot follow a token, and no test can assert a
   * value that is equal today.
   *
   * `Button variant="primary"` is the fix, and it brings the rest of the
   * primitive with it: `aria-busy` and a `<Spinner>` in place of the inline
   * `animate-spin` SVG, `active:` feedback that none of the 190 hand-rolled
   * buttons had, and one `disabled:` answer instead of this file's private one.
   * The label size moves text-sm → text-sm (the primitive's `md`), which is
   * what its six sibling modals already used — this file was the odd one.
   */
  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={updateMutation.isPending}
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        form="soul-edit-form"
        variant="primary"
        loading={updateMutation.isPending}
        disabled={!name.trim()}
      >
        {updateMutation.isPending ? t("souls.form.updating") : t("common.save")}
      </Button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("souls.form.edit_title") || "Edit Soul"}
      footer={footer}
    >
      {/* Four hand-wired label+control triples became `Field`. The name field
          carried the same `border-red-500 focus:border-red-500` / `text-red-500`
          that `Field.tsx:22-28` was written to remove: `red-500` is a palette
          literal and follows neither theme, so light mode was served the
          dark-mode error tone. `--color-status-error` is measured twice
          (`0 84% 62%` dark, `0 78% 44%` light) and follows.

          The `focus:` → `focus-visible:` switch rides along, and the state
          `<select>` is the case it was argued for: a mouse click on a select
          stops matching `:focus-visible`, so the accent border it used to paint
          on every click — which no keyboard user asked for and no mouse user
          could dismiss without clicking elsewhere — is gone, while Tab still
          shows it. A click into the text inputs still matches, so they keep it.

          Control text goes text-sm → text-sm (the primitive's `md`), matching
          the six sibling modals; the labels move to the shared
          `text-2xs uppercase` treatment for the same reason. */}
      <form id="soul-edit-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          id={nameId}
          label={t("souls.form.name_label")}
          type="text"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            clearFieldError('name')
          }}
          disabled={updateMutation.isPending}
          error={getError('name')}
          placeholder={t("souls.form.name_placeholder")}
        />

        {/* 生卒一行(第五十一批 F-1):出生 / 死亡 / 阳寿,写法与校验相同;阳寿只在地府出现。 */}
        <div className={`grid grid-cols-1 gap-3 items-start ${hasFatedDate ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <TextField
            id={birthDateId}
            label={t("souls.form.birth_date_label")}
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={updateMutation.isPending}
          />
          <TextField
            id={deathDateId}
            label={t("souls.death")}
            type="date"
            value={deathDate}
            onChange={(e) => setDeathDate(e.target.value)}
            disabled={updateMutation.isPending}
          />
          {hasFatedDate && (
            <TextField
              id={fatedDateId}
              label={`${t("souls.fated_death_date")} · ${t("hall_settings.visit.optional")}`}
              type="date"
              value={fatedDate}
              onChange={(e) => setFatedDate(e.target.value)}
              disabled={updateMutation.isPending}
            />
          )}
        </div>
        {hasFatedDate && (
          <div className="-mt-2 space-y-1 text-xs">
            <p className="m-0 text-[oklch(var(--color-ink-muted))]">{t("souls.fated_death_help")}</p>
            {/* 三个都填了、死亡早于阳寿:保存前就说这桩审判会候审。死亡晚于或等于阳寿时不说。 */}
            {birthDate && deathDate && fatedDate && deathDate < fatedDate && (
              <p data-testid="fated-death-preview" className="m-0 text-[oklch(var(--color-ink))]">
                {t("souls.fated_death_preview", { date: fatedDate })}
              </p>
            )}
          </div>
        )}

        {hasDuatPassage && (
          <div className="space-y-1">
            <SelectField
              id={duatId}
              label={t("souls.duat_passage.label")}
              value={duatPassage}
              onChange={(e) => setDuatPassage(e.target.value as SoulDuatPassage)}
              disabled={updateMutation.isPending}
              options={(["", "EARLY_DEATH", "NAMELESS", "IMPROPER_BURIAL"] as const).map((v) => ({
                value: v,
                label: t(`souls.duat_passage.${v || "NONE"}`),
              }))}
            />
            <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.duat_passage.help")}</p>
          </div>
        )}

        {hasInfernoFacts && (
          <div className="space-y-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <SelectField
                id={baptismId}
                label={t("souls.baptism.label")}
                value={baptism}
                onChange={(e) => setBaptism(e.target.value as SoulBaptism)}
                disabled={updateMutation.isPending}
                options={(["UNRECORDED", "BAPTISED", "UNBAPTISED", "BEFORE_CHRIST"] as const).map((v) => ({
                  value: v,
                  label: t(`souls.baptism.${v}`),
                }))}
              />
              <SelectField
                id={deniedId}
                label={t("souls.denied_immortality.label")}
                value={deniedImmortality === null ? "UNRECORDED" : deniedImmortality ? "YES" : "NO"}
                onChange={(e) => setDeniedImmortality(e.target.value === "UNRECORDED" ? null : e.target.value === "YES")}
                disabled={updateMutation.isPending}
                options={(["UNRECORDED", "YES", "NO"] as const).map((v) => ({
                  value: v,
                  label: t(`souls.denied_immortality.${v}`),
                }))}
              />
            </div>
            <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.baptism.help")}</p>
            <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.denied_immortality.help")}</p>
          </div>
        )}

        {/* 籍贯与出身地域同一行(Design W-1);文明在这里改不了,说明跟着灵魂自己的文明。 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <TextField
            id={locationId}
            label={t("souls.form.location_edit_label")}
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={updateMutation.isPending}
            placeholder={t("souls.form.location_placeholder")}
          />
          <OriginRegionField
            id={regionId}
            value={originRegion}
            onChange={setOriginRegion}
            disabled={updateMutation.isPending}
            civilization={soul.civilization}
          />
        </div>

        {/* SETTLED replaces the pick-list rather than joining it — see the
            `isSettled` note above. The option set is still built two ways, it
            is just an array now instead of two JSX branches. */}
        <SelectField
          id={stateId}
          label={t("souls.form.state_label")}
          value={currentState}
          onChange={(e) => setCurrentState(e.target.value as Soul["current_state"])}
          disabled={updateMutation.isPending || isSettled}
          options={
            isSettled
              ? [{ value: "SETTLED", label: t("souls.states.SETTLED") }]
              : STATE_OPTION_VALUES.map((val) => ({
                  value: val,
                  label: t(`souls.states.${val}`),
                }))
          }
        />
      </form>
    </BaseModal>
  );
}
