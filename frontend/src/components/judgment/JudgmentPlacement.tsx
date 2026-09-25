"use client";

import { useId } from "react";
import type { ConcludeJudgmentPayload, JudgmentVerdict } from "@soulledger/core/api";
import { useJudgmentDestinations } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { JudgmentSectionHead } from "@/src/components/judgment/JudgmentGroundsPanel";
import { SelectField, TextField } from "@/src/components/ui/Field";

/**
 * 戊 · 发落(原审判):目的地与刑期。都不选 = 自动分派,与以前一样 —— 所以空的发落不往结案
 * 请求里写任何字段。目的地只列 `GET /judgment/{id}/destinations/?candidate_verdict=` 给的门
 * (按所选裁决过滤);其余校验(容量、永恒)在结案事务里,拒绝以 `code` 回来,显示在这一节。
 */
export interface Placement {
  /** 选这份发落时的裁决。裁决一换,这份发落就不再作数(见 `placementFor`)。 */
  verdict: string;
  realmId: string;
  /** 只存正整数的十进制字符串,或空。 */
  term: string;
  eternal: boolean;
}

export const EMPTY_PLACEMENT: Placement = { verdict: "", realmId: "", term: "", eternal: false };

/** 结案接口的拒绝码里属于发落的那几个 —— 页面据此把拒绝画在这一节,而不是弹通用 toast。 */
export const PLACEMENT_REFUSALS = [
  "realm_full",
  "realm_not_allowed",
  "realm_not_found",
  "term_conflict",
  "eternal_not_allowed",
  "destination_not_applicable",
] as const;

/** 这份发落在 `verdict` 之下要加进结案请求的字段;为别的裁决选的发落一律不带。 */
export function placementFor(
  p: Placement,
  verdict: string
): Pick<ConcludeJudgmentPayload, "destination_realm_id" | "term_years" | "eternal"> {
  if (p.verdict !== verdict) return {};
  return {
    ...(p.realmId ? { destination_realm_id: p.realmId } : {}),
    ...(p.eternal ? { eternal: true } : p.term ? { term_years: Number(p.term) } : {}),
  };
}

export function JudgmentPlacement({
  judgmentId,
  verdict,
  value,
  onChange,
  refusal,
}: {
  judgmentId: string;
  verdict: string;
  value: Placement;
  onChange: (next: Placement) => void;
  /** The conclude refusal code, when it is one of PLACEMENT_REFUSALS. */
  refusal?: string | null;
}) {
  const { t } = useI18n();
  const { data, isLoading, isError } = useJudgmentDestinations(judgmentId, (verdict || null) as JudgmentVerdict | null);
  const eternalId = useId();
  const current = value.verdict === verdict ? value : { ...EMPTY_PLACEMENT, verdict };
  const set = (patch: Partial<Placement>) => onChange({ ...current, ...patch, verdict });

  const options = data?.options ?? [];
  const defaultRealm = options.find((o) => o.id === data?.default_realm_id);
  const chosen = options.find((o) => o.id === current.realmId) ?? (current.realmId ? undefined : defaultRealm);
  const canBeEternal = !!chosen?.is_eternal;

  let body;
  if (!verdict) {
    body = <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.placement.pick_verdict")}</p>;
  } else if (isLoading) {
    body = <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</p>;
  } else if (isError) {
    body = <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.placement.load_error")}</p>;
  } else if (options.length === 0) {
    body = <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.placement.none")}</p>;
  } else {
    body = (
      <div className="grid gap-3 pt-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <SelectField
          label={t("judgment.placement.destination")}
          value={current.realmId}
          onChange={(e) => set({ realmId: e.target.value, eternal: false })}
          options={[
            {
              value: "",
              label: defaultRealm
                ? t("judgment.placement.auto", { name: defaultRealm.name })
                : t("judgment.placement.auto_plain"),
            },
            ...options.map((o) => {
              const full = o.capacity !== null && o.occupancy >= o.capacity;
              const load = o.capacity === null ? `${o.occupancy}` : `${o.occupancy} / ${o.capacity}`;
              return {
                value: o.id,
                label: `${o.name} · ${load}${full ? ` · ${t("judgment.placement.full")}` : ""}`,
              };
            }),
          ]}
        />
        <TextField
          label={t("judgment.placement.term")}
          inputMode="numeric"
          value={current.eternal ? "" : current.term}
          disabled={current.eternal}
          // 只收正整数:非数字剥掉,前导零与单独的 0 归空。
          onChange={(e) => set({ term: String(Number(e.target.value.replace(/\D/g, "")) || "") })}
        />
        {canBeEternal && (
          <label htmlFor={eternalId} className="flex items-center gap-2 text-sm text-[oklch(var(--color-ink))] md:col-span-2">
            <input
              id={eternalId}
              type="checkbox"
              checked={current.eternal}
              onChange={(e) => set({ eternal: e.target.checked })}
              className="h-4 w-4 accent-[oklch(var(--color-accent))]"
            />
            {t("judgment.placement.eternal")}
          </label>
        )}
      </div>
    );
  }

  return (
    <section className="mt-6" data-testid="placement">
      <JudgmentSectionHead mark="戊" title={t("judgment.placement.title")} />
      {body}
      {refusal && (
        <p role="alert" className="mt-2 text-xs text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {t(`judgment.placement.errors.${refusal}`)}
        </p>
      )}
    </section>
  );
}
