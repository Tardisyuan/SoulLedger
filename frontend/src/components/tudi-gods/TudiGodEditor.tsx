"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cityGodKeys, cityGodsApi, tudiGodKeys, tudiGodsApi, type TudiGod } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Drawer } from "@/src/components/ui/Drawer";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { SelectField, TextField, fieldControl } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";
import { tudiRefusalCode, tudiRefusalMessage } from "./tudiDisplay";

/*
 * 编辑土地公(第五十七批 S-5):照城隍的编辑抽屉 —— 名字、管辖地(标签输入,同城隍地名)、上级城隍(只列本殿的,
 * 已定级的只列县城隍:后端 `tudi_city_god_not_county` 拒别的级别)、名下官员。删除在底部左侧,二次确认。
 * ponytail: 名下官员的候选借用城隍抽屉的 `officer-choices`(持 `city_god.execute` 的人;这个接口本身要 `city_god.manage`,
 * 只持 `tudi.manage` 的人取不到候选);土地公后端按 `tudi.register` 校验,两份名单不同时保存会被 `invalid_officer`
 * 拒并写出原因。默认授予下两组码同一批角色。要分开就给土地公加一个自己的候选接口。
 */

interface Props {
  /** null = 新建。 */
  god: TudiGod | null;
  onClose: () => void;
}

const LABEL = "block text-sm font-medium text-[oklch(var(--color-ink))]";
const HINT = "text-xs text-[oklch(var(--color-ink-muted))]";

export function TudiGodEditor({ god, onClose }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(god?.name ?? "");
  const [regions, setRegions] = useState<string[]>(god?.regions ?? []);
  const [draft, setDraft] = useState("");
  const [cityGod, setCityGod] = useState<string>(god?.city_god ?? "");
  const [officerIds, setOfficerIds] = useState<number[]>((god?.officers ?? []).map((o) => o.id));
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  const gods = useQuery({ queryKey: cityGodKeys.gods(), queryFn: () => cityGodsApi.list().then((r) => r.data.results) });
  const choices = useQuery({ queryKey: [...cityGodKeys.all, "officer-choices"], queryFn: () => cityGodsApi.officerChoices().then((r) => r.data) });
  const parents = (gods.data ?? []).filter((g) => !g.rank || g.rank === "COUNTY" || g.id === god?.city_god);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), regions, city_god: cityGod || null, officer_ids: officerIds };
      return god ? tudiGodsApi.update(god.id, body) : tudiGodsApi.create(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tudiGodKeys.all });
      showToast(t("earthGods.saved_toast"), "success");
      onClose();
    },
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: () => tudiGodsApi.remove(god!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tudiGodKeys.all });
      showToast(t("earthGods.deleted_toast"), "success");
      onClose();
    },
    onError: () => showToast(t("common.error"), "error"),
  });

  const addRegion = () => {
    const value = draft.trim();
    if (value && !regions.some((r) => r.toLowerCase() === value.toLowerCase())) setRegions([...regions, value]);
    setDraft("");
  };
  const code = error ? tudiRefusalCode(error) : null;
  const message = error ? tudiRefusalMessage(error, t) : null;

  return (
    <>
      <Drawer
        isOpen
        onClose={onClose}
        title={god ? `${t("earthGods.edit")} · ${god.name}` : t("earthGods.create")}
        footer={
          <div className="flex items-center gap-2">
            {god && (
              <Button type="button" variant="ghost" size="sm" data-testid="tudi-god-delete" onClick={() => setConfirming(true)}>
                {t("earthGods.delete")}
              </Button>
            )}
            <span className="flex-1" />
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="primary" size="sm" data-testid="tudi-god-save" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-6 p-4">
          <TextField
            id="tudi-god-name"
            label={t("earthGods.title")}
            value={name}
            required
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            error={code === "name_taken" ? message : null}
          />

          <div className="space-y-2">
            <label htmlFor="tudi-god-region" className={LABEL}>{t("earthGods.jurisdiction")}</label>
            <div className="flex flex-wrap gap-2">
              {regions.map((r) => (
                <span key={r} data-region-tag={r} className="inline-flex items-center gap-1 border border-[oklch(var(--color-line))] px-2 py-0.5 text-sm text-[oklch(var(--color-ink))]">
                  {r}
                  <button
                    type="button"
                    aria-label={`${t("earthGods.delete")} ${r}`}
                    className="text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]"
                    onClick={() => setRegions(regions.filter((x) => x !== r))}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </span>
              ))}
            </div>
            <input
              id="tudi-god-region"
              data-testid="tudi-god-region-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addRegion();
                }
              }}
              onBlur={addRegion}
              className={fieldControl({ size: "md" })}
            />
          </div>

          <SelectField
            id="tudi-god-city-god"
            label={t("earthGods.parent_city_god")}
            value={cityGod}
            onChange={(e) => {
              setCityGod(e.target.value);
              setError(null);
            }}
            error={code === "invalid_city_god" || code === "tudi_city_god_not_county" ? message : null}
            options={[
              { value: "", label: t("earthGods.no_parent") },
              ...parents.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />

          <fieldset className="space-y-2">
            <legend className={LABEL}>{t("earthGods.officers")}</legend>
            <ul className="max-h-48 overflow-y-auto border border-[oklch(var(--color-line))]">
              {(choices.data ?? []).map((o) => (
                <li key={o.id}>
                  <label className="flex items-center gap-2 px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={officerIds.includes(o.id)}
                      onChange={(e) => setOfficerIds(e.target.checked ? [...officerIds, o.id] : officerIds.filter((id) => id !== o.id))}
                    />
                    {o.name}
                  </label>
                </li>
              ))}
            </ul>
            {code === "invalid_officer" && <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{message}</p>}
            <p className={HINT}>{t("earthGods.officers_hint")}</p>
          </fieldset>

          {error && !["name_taken", "invalid_city_god", "tudi_city_god_not_county", "invalid_officer"].includes(code ?? "") ? (
            <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">{message}</p>
          ) : null}
        </div>
      </Drawer>

      {god && (
        <BaseModal
          isOpen={confirming}
          onClose={() => setConfirming(false)}
          title={t("earthGods.delete")}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
              <Button type="button" variant="secondary" loading={remove.isPending} data-testid="tudi-god-delete-confirm" onClick={() => remove.mutate()}>
                {t("earthGods.delete")}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t("earthGods.delete_confirm", { name: god.name })}</p>
        </BaseModal>
      )}
    </>
  );
}
