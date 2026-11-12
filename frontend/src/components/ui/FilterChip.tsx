"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/src/contexts/I18nContext";
import { Drawer } from "@/src/components/ui/Drawer";
import { Button } from "@/src/components/ui/Button";

/**
 * 筛选签 · 规范 v2 补足 A1「筛选条」:选中 / 常态 / 悬停 / 焦点 / 禁用。
 * 常态:透明底、1px ink3 框、ink 字;悬停 s2;**选中 = ink 实底、纸色字、前面一个 ✓**
 * (A1:「✓ 第五殿 · 12」)—— 选中不只靠颜色,✓ 与清除用的 × 一起说「这条筛选生效了」。
 * 选中不用匾色:匾色只有五处用法,筛选不在其中。
 *
 * Badges are never clickable; anything a user clicks to narrow a list is one of these.
 */
const base =
  "inline-flex h-(--control-h-sm) shrink-0 items-center gap-1 rounded-control border px-3 text-xs whitespace-nowrap transition-colors duration-fast ease-standard";
const idle =
  "border-[oklch(var(--color-line-strong))] bg-transparent text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] active:bg-[oklch(var(--color-line))]";
const on =
  "border-[oklch(var(--color-ink))] bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]";

export function filterChipClass(active: boolean) {
  return cn(base, active ? on : idle);
}

export interface FilterChipOption {
  value: string;
  label: string;
}

interface FilterChipSelectProps {
  /** The dimension, shown before the value: 「状态 · 审判中」. Also the accessible name. */
  label: string;
  value: string;
  /** Must include the "" (no filter) option; its label is what the chip shows at rest. */
  options: FilterChipOption[];
  onChange: (_value: string) => void;
  /** Accessible name of the × — e.g. 「清除状态筛选」. */
  clearLabel: string;
  disabled?: boolean;
}

/**
 * A native `<select>` inside the chip: the option list, keyboard behaviour and
 * mobile picker stay the platform's. The chip is the frame; the select fills it.
 */
export function FilterChipSelect({ label, value, options, onChange, clearLabel, disabled }: FilterChipSelectProps) {
  const active = value !== "";
  return (
    <span data-filter-chip="" data-active={active || undefined} className={cn(filterChipClass(active), disabled && "text-[oklch(var(--color-disabled-ink))] border-[oklch(var(--color-line))]")}>
      {active && <span aria-hidden="true">✓</span>}
      <span aria-hidden="true" className={active ? undefined : "text-[oklch(var(--color-ink-subtle))]"}>{label} ·</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pr-1 text-xs text-inherit cursor-pointer disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {active ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
          className="text-inherit"
        >
          ×
        </button>
      ) : (
        <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">▾</span>
      )}
    </span>
  );
}

interface FilterChipToggleProps {
  pressed: boolean;
  onPressedChange: (_pressed: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}

/** An on/off filter (e.g. 「仅看有问题的」). `aria-pressed` says the state; the chip style shows it. */
export function FilterChipToggle({ pressed, onPressedChange, children, disabled }: FilterChipToggleProps) {
  return (
    <button
      type="button"
      data-filter-chip=""
      data-active={pressed || undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(filterChipClass(pressed), "disabled:text-[oklch(var(--color-disabled-ink))] disabled:border-[oklch(var(--color-line))] disabled:cursor-not-allowed")}
    >
      {pressed && <span aria-hidden="true">✓</span>}
      {children}
      {pressed && <span aria-hidden="true">×</span>}
    </button>
  );
}

/**
 * 快捷 chip(第三十批「卷宗」第 1 步第 4 条,393 窄屏):高 44(`--control-h-sm`,触屏档)、圆角 22(胶囊)、
 * 不压缩、不截字;选中 = 1.5px 墨色内描边 + ink 字 500,常态 line 描边 + ink-muted 字(稿子 `.chip` / `.chip.on`)。
 * 只在 `FilterBar` 的那一行横滑里用。
 */
const QUICK_CHIP =
  "inline-flex h-(--control-h-sm) shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm transition-colors duration-fast ease-standard";
const QUICK_IDLE = "shadow-[inset_0_0_0_1px_oklch(var(--color-line-strong))] text-[oklch(var(--color-ink-muted))]";
const QUICK_ON = "shadow-[inset_0_0_0_1.5px_oklch(var(--color-ink))] text-[oklch(var(--color-ink))] font-medium";

export interface FilterBarSelect {
  /** 维度名(「裁决」),也是读屏名。 */
  label: string;
  value: string;
  /** 必须含 ""(不筛)那一项。 */
  options: FilterChipOption[];
  onChange: (_value: string) => void;
  /** × 的读屏名(「清除裁决筛选」)。 */
  clearLabel: string;
}

export interface FilterBarQuick {
  label: ReactNode;
  active: boolean;
  onToggle: () => void;
}

/**
 * 列表页的筛选条(第三十批「卷宗」第 1 步第 4 条,Design v4 第三十批第一节)。一份声明,两种画法:
 *
 * - **≥ 769(桌面)**:照旧一行 —— 搜索框、每个维度一个 `FilterChipSelect`、右端 `trailing`(导出、列)。
 * - **≤ 768(393 窄屏)**:第一行 搜索框 48 +「筛选 · N」48(N = 已生效的条件数);第二行快捷 chip,高 44、
 *   圆角 22,一行横滑、右缘 40px 渐隐(`.chip-scroll`),chip 不压缩、不截字;其余条件都进底部抽屉 —— 选项行 48,
 *   主按钮 56、墨色实底。`trailing` 在窄屏收进抽屉底部。
 *
 * 两种画法都在 DOM 里,按宽度用 CSS 藏一种(`max-[768px]:hidden` / `min-[769px]:hidden`),不靠 JS 量宽:
 * 首帧就对。抽屉里改的就是同一份状态,即时生效;主按钮只是收起抽屉。
 */
export function FilterBar({
  search,
  selects,
  quick,
  trailing,
  testId,
}: {
  /** 搜索框(调用方给,桌面与窄屏同一个元素各画一份,所以传一个渲染函数)。 */
  search?: (where: "wide" | "narrow") => ReactNode;
  selects: FilterBarSelect[];
  /** 窄屏第二行的快捷 chip。不给就没有那一行。 */
  quick?: FilterBarQuick[];
  /** 桌面一行的右端(导出、列设置)。窄屏收进抽屉底部。 */
  trailing?: ReactNode;
  testId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const active = selects.filter((f) => f.value !== "").length;
  return (
    <div data-testid={testId} data-filter-bar="">
      {/* 桌面 */}
      <div data-filter-bar-wide="" className="max-[768px]:hidden flex flex-wrap items-center gap-3 py-3">
        {search?.("wide")}
        {selects.map((f) => (
          <FilterChipSelect key={f.label} label={f.label} value={f.value} options={f.options} onChange={f.onChange} clearLabel={f.clearLabel} />
        ))}
        {trailing ? <div className="ml-auto flex items-center justify-end gap-3">{trailing}</div> : null}
      </div>

      {/* 393 窄屏 */}
      <div data-filter-bar-narrow="" className="min-[769px]:hidden grid gap-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{search?.("narrow")}</div>
          <button
            type="button"
            data-filter-bar-open=""
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className="inline-flex h-(--control-h-md) shrink-0 items-center gap-2 whitespace-nowrap rounded-control border border-[oklch(var(--color-line-strong))] px-4 text-md font-medium text-[oklch(var(--color-ink))]"
          >
            {active > 0 ? t("filter.bar.open_n", { n: String(active) }) : t("filter.bar.open")}
          </button>
        </div>
        {quick && quick.length > 0 ? (
          <div role="group" aria-label={t("filter.bar.quick")} data-filter-bar-quick="" className="chip-scroll flex gap-2 overflow-x-auto pr-8">
            {quick.map((q, i) => (
              <button key={i} type="button" aria-pressed={q.active} onClick={q.onToggle} className={cn(QUICK_CHIP, q.active ? QUICK_ON : QUICK_IDLE)}>
                {q.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Drawer
        isOpen={open}
        onClose={() => setOpen(false)}
        variant="layer"
        title={t("filter.bar.title")}
        footer={
          <div className="grid gap-3">
            {trailing ? <div className="flex flex-wrap items-center gap-3">{trailing}</div> : null}
            <Button type="button" variant="primary" size="lg" className="w-full" onClick={() => setOpen(false)}>
              {t("filter.bar.done")}
            </Button>
          </div>
        }
      >
        <div data-filter-bar-sheet="">
          {selects.map((f) => (
            <label key={f.label} className="flex min-h-(--control-h-md) items-center gap-3 border-b border-[oklch(var(--color-line))] text-md">
              <span className="text-[oklch(var(--color-ink))]">{f.label}</span>
              <select
                aria-label={f.label}
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                className="ml-auto min-h-(--control-h-md) min-w-0 appearance-none bg-transparent text-right text-[oklch(var(--color-ink-muted))]"
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
