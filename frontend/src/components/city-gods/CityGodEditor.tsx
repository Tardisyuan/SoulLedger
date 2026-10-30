"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cityGodKeys, cityGodsApi, type CityGod, type CityGodWrite } from "@soulledger/core/api";
import { CITY_GOD_BUREAU_GROUPS, CITY_GOD_BUREAU_PRESETS, CITY_GOD_RANKS } from "@soulledger/core/domain/cityGods";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Drawer } from "@/src/components/ui/Drawer";
import { Button } from "@/src/components/ui/Button";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { TextField, fieldControl } from "@/src/components/ui/Field";
import { Collapse } from "@/src/components/ui/Collapse";
import { Segmented } from "@/src/components/ui/Segmented";
import { showToast } from "@/src/components/ui/Toast";
import { cityGodFieldMessage, cityGodFieldRefusal, type CityGodFieldRefusal } from "./cityGodDisplay";
import { responseCode, responseData } from "@soulledger/core/api/client";

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

/**
 * 下属诸司(第五十七批 D-3):7 组默认收起,组头写「已选 / 共有」,点开是两列复选框。右上「按{级别}预设」一键勾上
 * 这一级通常有的司(`CITY_GOD_BUREAU_PRESETS`,工程提议),之后可以再改;会替换现有勾选时先确认。
 */
export function BureauPicker({ rank, bureaus, onChange }: { rank: string; bureaus: string[]; onChange: (next: string[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const preset = rank ? CITY_GOD_BUREAU_PRESETS[rank as keyof typeof CITY_GOD_BUREAU_PRESETS] : undefined;
  const level = rank ? t(`cityGods.ranks.${rank}`) : "";
  const applyPreset = () => {
    if (!preset) return;
    const same = bureaus.length === preset.length && preset.every((b) => bureaus.includes(b));
    if (bureaus.length > 0 && !same) setConfirming(true);
    else onChange([...preset]);
  };
  return (
    <fieldset className="relative space-y-2" data-testid="city-god-bureaus">
      <legend className={LABEL}>{t("cityGods.bureaus_label")}</legend>
      {preset && (
        <Button type="button" variant="ghost" size="sm" className="absolute right-0 -top-1" data-testid="city-god-bureau-preset" onClick={applyPreset}>
          {t("cityGods.bureaus_preset", { level })}
        </Button>
      )}
      <ul className="border-t border-[oklch(var(--color-line))]">
        {CITY_GOD_BUREAU_GROUPS.map((group) => {
          const isOpen = open.has(group.ministry);
          const id = `city-god-ministry-${group.ministry}`;
          const picked = group.bureaus.filter((b) => bureaus.includes(b)).length;
          return (
            <li key={group.ministry} className="border-b border-[oklch(var(--color-line))]">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                data-ministry={group.ministry}
                onClick={() => {
                  const next = new Set(open);
                  if (isOpen) next.delete(group.ministry);
                  else next.add(group.ministry);
                  setOpen(next);
                }}
                className="flex w-full items-center gap-2 min-h-(--control-h-sm) text-sm text-[oklch(var(--color-ink))]"
              >
                <span aria-hidden="true" className="w-3 text-[oklch(var(--color-ink-subtle))]">{isOpen ? "▾" : "▸"}</span>
                <span className="flex-1 text-left">{t(`cityGods.ministries.${group.ministry}`)}</span>
                <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]" data-testid="ministry-count">
                  {t("cityGods.bureaus_group_count", { selected: String(picked), total: String(group.bureaus.length) })}
                </span>
              </button>
              <Collapse open={isOpen} id={id}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pb-2 pl-6">
                  {group.bureaus.map((b) => (
                    <label key={b} className="inline-flex items-center gap-1 text-sm text-[oklch(var(--color-ink))]">
                      <input
                        type="checkbox"
                        data-bureau={b}
                        checked={bureaus.includes(b)}
                        onChange={(e) => onChange(e.target.checked ? [...bureaus, b] : bureaus.filter((x) => x !== b))}
                      />
                      {t(`cityGods.bureau_names.${b}`)}
                    </label>
                  ))}
                </div>
              </Collapse>
            </li>
          );
        })}
      </ul>
      <p className={HINT}>{t("cityGods.bureaus_hint")}</p>
      <ConfirmDialog
        isOpen={confirming}
        variant="info"
        title={t("cityGods.bureaus_preset", { level })}
        message={t("cityGods.bureaus_preset_confirm", { n: String(bureaus.length) })}
        confirmText={t("cityGods.bureaus_preset", { level })}
        onConfirm={() => {
          if (preset) onChange([...preset]);
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </fieldset>
  );
}

export function CityGodEditor({ god, gods, onClose }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(god?.name ?? "");
  const [regions, setRegions] = useState<string[]>(god?.regions ?? []);
  const [draft, setDraft] = useState("");
  const [isDefault, setIsDefault] = useState(god?.is_default ?? false);
  const [rank, setRank] = useState<string>(god?.rank ?? "");
  const [bureaus, setBureaus] = useState<string[]>(god?.bureaus ?? []);
  const [officerIds, setOfficerIds] = useState<number[]>((god?.officers ?? []).map((o) => o.id));
  const [search, setSearch] = useState("");
  const [refusal, setRefusal] = useState<CityGodFieldRefusal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState<number | null>(null);

  const choices = useQuery({ queryKey: [...cityGodKeys.all, "officer-choices"], queryFn: () => cityGodsApi.officerChoices().then((r) => r.data) });
  const currentDefault = gods.find((g) => g.is_default && g.id !== god?.id);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(), regions, is_default: isDefault, officer_ids: officerIds,
        rank: rank as CityGodWrite["rank"], bureaus: bureaus as CityGodWrite["bureaus"],
      };
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
      if (responseCode(err) === "city_god_has_open_cases")
        setBlocked(responseData<{ count: number }>(err)?.count ?? god?.open_case_count ?? 0);
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

          {/* 级别(第五十七批 D-3):分段。封号随级别定(明代史实,用户 2026-10-28),下面一句写出它怎么显示。 */}
          <div className="space-y-1">
            <p className={LABEL}>{t("cityGods.rank")}</p>
            <Segmented
              label={t("cityGods.rank")}
              value={rank}
              options={[...CITY_GOD_RANKS.map((r) => ({ value: r as string, label: t(`cityGods.ranks.${r}`) })), { value: "", label: t("cityGods.rank_none") }]}
              onChange={(r) => {
                setRank(r);
                setRefusal(null);
              }}
              fill
              data-testid="city-god-rank"
            />
            <p className={HINT}>
              {rank ? `${t(`cityGods.ranks.${rank}`)} · ${t(`cityGods.rank_titles.${rank}`)}` : t("cityGods.rank_none")}
            </p>
          </div>

          <BureauPicker rank={rank} bureaus={bureaus} onChange={setBureaus} />

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
