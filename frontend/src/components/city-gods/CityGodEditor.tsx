"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cityGodKeys, cityGodsApi, type CityGod } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Drawer } from "@/src/components/ui/Drawer";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { TextField, fieldControl } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";
import { cityGodFieldMessage, cityGodFieldRefusal, type CityGodFieldRefusal } from "./cityGodDisplay";

/*
 * 编辑城隍(第五十三批 G-2):右侧抽屉,不离开列表。地名是标签输入(回车加一个,去掉首尾空格,重复的不加);
 * `region_taken` 把冲突的那一枚描红,下面一句点名地名和城隍。兜底开关的说明里直接写出现在的兜底是谁。
 * 删除在底部左侧,二次确认;409 `city_god_has_open_cases` 时确认层换成那句拒绝,带「去初审队列」(已按这位城隍筛好)。
 */

interface Props {
  /** null = 新建。 */
  god: CityGod | null;
  gods: readonly CityGod[];
  onClose: () => void;
}

const LABEL = "block text-sm font-medium text-[oklch(var(--color-ink))]";
const HINT = "text-xs text-[oklch(var(--color-ink-muted))]";

export function CityGodEditor({ god, gods, onClose }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(god?.name ?? "");
  const [regions, setRegions] = useState<string[]>(god?.regions ?? []);
  const [draft, setDraft] = useState("");
  const [isDefault, setIsDefault] = useState(god?.is_default ?? false);
  const [officerIds, setOfficerIds] = useState<number[]>((god?.officers ?? []).map((o) => o.id));
  const [search, setSearch] = useState("");
  const [refusal, setRefusal] = useState<CityGodFieldRefusal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState<number | null>(null);

  const choices = useQuery({ queryKey: [...cityGodKeys.all, "officer-choices"], queryFn: () => cityGodsApi.officerChoices().then((r) => r.data) });
  const currentDefault = gods.find((g) => g.is_default && g.id !== god?.id);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), regions, is_default: isDefault, officer_ids: officerIds };
      return god ? cityGodsApi.update(god.id, body) : cityGodsApi.create(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cityGodKeys.all });
      showToast(t("cityGods.saved_toast"), "success");
      onClose();
    },
    onError: (err) => setRefusal(cityGodFieldRefusal(err) ?? { code: "" }),
  });
  const remove = useMutation({
    mutationFn: () => cityGodsApi.remove(god!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cityGodKeys.all });
      showToast(t("cityGods.deleted_toast"), "success");
      onClose();
    },
    onError: (err) => {
      const data = (err as { response?: { data?: { code?: string; count?: number } } })?.response?.data;
      if (data?.code === "city_god_has_open_cases") setBlocked(data.count ?? god?.open_case_count ?? 0);
      else showToast(t("judgment.claim.refused.generic"), "error");
    },
  });

  const addRegion = () => {
    const value = draft.trim();
    if (value && !regions.some((r) => r.toLowerCase() === value.toLowerCase())) setRegions([...regions, value]);
    setDraft("");
  };
  const taken = new Set((refusal?.code === "region_taken" ? refusal.regions ?? [refusal.region ?? ""] : []).map((r) => r.toLowerCase()));
  const message = refusal ? (refusal.code ? cityGodFieldMessage(refusal, t) : t("judgment.claim.refused.generic")) : null;
  const shown = (choices.data ?? []).filter((o) => !search.trim() || o.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <Drawer
        isOpen
        onClose={onClose}
        title={god ? `${t("cityGods.edit")} · ${god.name}` : t("cityGods.create")}
        footer={
          <div className="flex items-center gap-2">
            {god && (
              <Button type="button" variant="ghost" size="sm" data-testid="city-god-delete" onClick={() => setConfirming(true)}>
                {t("cityGods.delete")}
              </Button>
            )}
            <span className="flex-1" />
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="primary" size="sm" data-testid="city-god-save" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-6 p-4">
          <TextField
            label={t("cityGods.name")}
            value={name}
            required
            onChange={(e) => {
              setName(e.target.value);
              setRefusal(null);
            }}
            error={refusal?.code === "name_taken" ? message : null}
          />

          <div className="space-y-2">
            <label htmlFor="city-god-region" className={LABEL}>{t("cityGods.regions")}</label>
            <div className="flex flex-wrap gap-2">
              {regions.map((r) => (
                <span
                  key={r}
                  data-region-tag={r}
                  data-taken={taken.has(r.toLowerCase()) || undefined}
                  className={cn(
                    "inline-flex items-center gap-1 border px-2 py-0.5 text-sm",
                    taken.has(r.toLowerCase())
                      ? "border-[oklch(var(--color-danger))] text-[oklch(var(--color-danger))]"
                      : "border-[oklch(var(--color-line))] text-[oklch(var(--color-ink))]",
                  )}
                >
                  {r}
                  <button
                    type="button"
                    aria-label={`${t("cityGods.delete")} ${r}`}
                    className="text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]"
                    onClick={() => {
                      setRegions(regions.filter((x) => x !== r));
                      setRefusal(null);
                    }}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </span>
              ))}
            </div>
            <input
              id="city-god-region"
              data-testid="city-god-region-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addRegion();
                }
              }}
              onBlur={addRegion}
              className={fieldControl({ size: "md", invalid: refusal?.code === "region_taken" })}
            />
            {refusal?.code === "region_taken" && <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{message}</p>}
            <p className={HINT}>{t("cityGods.regions_hint")}</p>
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink))]">
              <input
                type="checkbox"
                role="switch"
                data-testid="city-god-default"
                checked={isDefault}
                onChange={(e) => {
                  setIsDefault(e.target.checked);
                  setRefusal(null);
                }}
              />
              {t("cityGods.is_default")}
            </label>
            <p className={HINT}>
              {t("cityGods.default_hint")}
              {currentDefault ? ` ${t("cityGods.default_current", { name: currentDefault.name })}` : ""}
            </p>
            {refusal?.code === "default_taken" && <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{message}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="city-god-officer-search" className={LABEL}>{t("cityGods.officers")}</label>
            <input
              id="city-god-officer-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={fieldControl({ size: "sm" })}
            />
            <ul className="max-h-48 overflow-y-auto border border-[oklch(var(--color-line))]">
              {shown.map((o) => (
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
            {refusal?.code === "invalid_officer" && <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">{message}</p>}
            <p className={HINT}>{t("cityGods.officers_hint")}</p>
          </div>

          {refusal && !["name_taken", "region_taken", "default_taken", "invalid_officer"].includes(refusal.code) && (
            <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">{message}</p>
          )}
        </div>
      </Drawer>

      {god && (
        <BaseModal
          isOpen={confirming}
          onClose={() => {
            setConfirming(false);
            setBlocked(null);
          }}
          title={t("cityGods.delete")}
          footer={
            blocked === null ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
                <Button type="button" variant="secondary" loading={remove.isPending} data-testid="city-god-delete-confirm" onClick={() => remove.mutate()}>
                  {t("cityGods.delete")}
                </Button>
              </>
            ) : (
              <Button type="button" variant="secondary" onClick={() => { setConfirming(false); setBlocked(null); }}>{t("common.cancel")}</Button>
            )
          }
        >
          {blocked === null ? (
            <p className="text-sm">{t("cityGods.delete_confirm", { name: god.name })}</p>
          ) : (
            <div className="space-y-2" data-testid="city-god-delete-blocked">
              <p className="text-sm">{t("cityGods.error.city_god_has_open_cases", { name: god.name, count: String(blocked) })}</p>
              <Link href={`/city-god-cases?city_god=${god.id}`} className="text-sm underline underline-offset-2">
                {t("cityGods.go_to_queue")}
              </Link>
            </div>
          )}
        </BaseModal>
      )}
    </>
  );
}
