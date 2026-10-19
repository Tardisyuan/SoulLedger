"use client";

import type { SoulOriginRegion } from "@soulledger/core/api";
import { ORIGIN_REGIONS, originRegionLabel, originRegionMember } from "@soulledger/core/domain/originRegion";
import { useI18n } from "@/src/contexts/I18nContext";

/** 表单里的值 ↔ 成员:"" 是不详。 */
const VALUE_OF = { EUROPE: "EUROPE", ASIA: "ASIA", UNKNOWN: "" } as const satisfies Record<string, SoulOriginRegion>;

/**
 * 出身地域的读法(Design W-2):「不详」是正文墨色的一个词,不是缺值的「—」—— 它是登记了的事实(没人知道),
 * 不是没登记。原值进 `title`(空值写 UNKNOWN,与条件事实同名)。
 */
export function OriginRegionText({ value, className }: { value: string | null | undefined; className?: string }) {
  const { t, locale } = useI18n();
  return (
    <span title={originRegionMember(value)} data-origin-region={originRegionMember(value)} className={className}>
      {originRegionLabel(t, value, locale)}
    </span>
  );
}

/**
 * 登记 / 编辑灵魂表单里的「出身地域」(Design W-1):欧洲 / 亚洲 / 不详 三段,默认不详,与「籍贯」同一行。
 * 一组单选:方向键在三段间移动。只有希腊殿的灵魂下面多一句说明(它决定谁主审);别的文明不显示。
 */
export function OriginRegionField({
  id,
  value,
  onChange,
  disabled,
  civilization,
}: {
  id: string;
  value: SoulOriginRegion;
  onChange: (next: SoulOriginRegion) => void;
  disabled?: boolean;
  civilization: string | null | undefined;
}) {
  const { t, locale } = useI18n();
  const current = originRegionMember(value);
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const greek = civilization === "GREEK";
  return (
    <div data-field="" className="flex flex-col gap-1">
      <span id={labelId} className="text-xs text-[oklch(var(--color-ink-muted))]">
        {t("souls.origin_region.label")}
      </span>
      <div
        role="radiogroup"
        id={id}
        aria-labelledby={labelId}
        aria-describedby={greek ? hintId : undefined}
        className="flex h-(--control-h-md) rounded-control border border-[oklch(var(--color-line-strong))] overflow-hidden"
      >
        {ORIGIN_REGIONS.map((member, i) => {
          const on = member === current;
          return (
            <button
              key={member}
              type="button"
              role="radio"
              aria-checked={on}
              title={member}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(VALUE_OF[member])}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = (i + step + ORIGIN_REGIONS.length) % ORIGIN_REGIONS.length;
                onChange(VALUE_OF[ORIGIN_REGIONS[next]]);
                (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              }}
              className={`flex-1 min-w-0 px-2 text-sm border-l first:border-l-0 border-[oklch(var(--color-line-strong))] disabled:opacity-50 ${
                on
                  ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))]"
                  : "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
              }`}
            >
              {originRegionLabel(t, VALUE_OF[member], locale)}
            </button>
          );
        })}
      </div>
      {greek ? (
        <span id={hintId} data-testid="origin-region-hint" className="text-2xs tracking-normal text-[oklch(var(--color-ink-subtle))]">
          {t("souls.form.origin_region_hint_greek")}
        </span>
      ) : null}
    </div>
  );
}
