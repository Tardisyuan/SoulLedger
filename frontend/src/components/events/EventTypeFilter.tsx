"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { useI18n } from "@/src/contexts/I18nContext";
import { filterChipClass } from "@/src/components/ui/FilterChip";
import { fieldControl } from "@/src/components/ui/Field";
import { SOUL_EVENT_GROUPS, type SoulEventGroup } from "@/lib/events/event_registry";
import { makeSystemEventLabels } from "@/src/components/souls/soulLifecycleRows";

interface Option {
  value: string;
  label: string;
}

interface Group {
  /** `""` is the unlabeled head group that holds 「全部事件」. */
  value: SoulEventGroup | "";
  items: Option[];
}

/**
 * 「灵魂事件」页的事件类型筛选(第三十七批 W-13b):单选,按六个大类分组,组名不可选,顶上可以搜索。
 *
 * 一枚筛选签作触发器,与 `FilterChipSelect` 同一个外框。原生 `<select>` 的 `<optgroup>` 能分组,
 * 但下拉里放不进搜索框,所以这里用 Base UI 的 Combobox(输入框在弹层里),过滤交给它的默认过滤 ——
 * 选项是本地的 39 个事件名,不是服务器分页的结果(那种情况见 `SearchSelectField` 为什么关掉过滤)。
 * 事件名复用灵魂时间线的 `souls.events.*`,不另起一套。
 */
export function EventTypeFilter({ value, onChange }: { value: string; onChange: (_value: string) => void }) {
  const { t } = useI18n();
  const dimension = t("events.col_event");

  const groups: Group[] = useMemo(() => {
    const { eventType: label } = makeSystemEventLabels(t);
    return [
      { value: "", items: [{ value: "", label: t("events.all_types") }] },
      ...(Object.keys(SOUL_EVENT_GROUPS) as SoulEventGroup[]).map((group) => ({
        value: group,
        items: SOUL_EVENT_GROUPS[group].map((type) => ({ value: type, label: label(type) })),
      })),
    ];
  }, [t]);

  const all = groups[0].items[0];
  const selected = groups.flatMap((g) => g.items).find((o) => o.value === value) ?? all;
  const active = value !== "";

  return (
    <Combobox.Root
      items={groups}
      value={selected}
      onValueChange={(next: Option | null) => onChange(next?.value ?? "")}
      itemToStringLabel={(o: Option) => o.label}
      isItemEqualToValue={(a: Option, b: Option) => a.value === b.value}
    >
      <span data-filter-chip="" data-active={active || undefined} className={filterChipClass(active)}>
        {active && <span aria-hidden="true">✓</span>}
        <Combobox.Trigger aria-label={dimension} className="inline-flex items-center gap-1 text-inherit cursor-pointer">
          <span aria-hidden="true" className={active ? undefined : "text-[oklch(var(--color-ink-subtle))]"}>{dimension} ·</span>
          {selected.label}
        </Combobox.Trigger>
        {active ? (
          <button
            type="button"
            aria-label={t("filter.clear_one", { name: dimension })}
            onClick={() => onChange("")}
            className="text-inherit"
          >
            ×
          </button>
        ) : (
          <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">▾</span>
        )}
      </span>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="z-dialog">
          <Combobox.Popup className="w-80 max-h-96 overflow-y-auto bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-ink))] py-1">
            <div className="px-2 pt-1 pb-2">
              <Combobox.Input
                placeholder={t("events.search_type")}
                aria-label={t("events.search_type")}
                className={fieldControl({ size: "sm" })}
              />
            </div>
            <Combobox.Empty className="px-3 py-2 text-xs text-[oklch(var(--color-ink-subtle))] empty:hidden">
              {t("events.empty")}
            </Combobox.Empty>
            <Combobox.List>
              {(group: Group) => (
                <Combobox.Group key={group.value || "all"} items={group.items}>
                  {group.value ? (
                    <Combobox.GroupLabel className="px-3 pt-2 pb-0.5 text-xs text-[oklch(var(--color-ink-muted))]">
                      {t(`events.groups.${group.value}`)}
                    </Combobox.GroupLabel>
                  ) : null}
                  <Combobox.Collection>
                    {(option: Option) => (
                      <Combobox.Item
                        key={option.value || "all"}
                        value={option}
                        className={`flex min-h-(--control-h-sm) items-center text-sm text-[oklch(var(--color-ink))] cursor-pointer data-highlighted:bg-[oklch(var(--color-surface-2))] data-selected:font-medium ${group.value ? "pl-6 pr-3" : "px-3"}`}
                      >
                        {option.label}
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
