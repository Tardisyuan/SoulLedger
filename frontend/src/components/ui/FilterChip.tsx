"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 筛选签 · 规范 v2 补足 A1「筛选条」:选中 / 常态 / 悬停 / 焦点 / 禁用。
 * 常态:透明底、1px ink3 框、ink 字;悬停 s2;**选中 = ink 实底、纸色字、前面一个 ✓**
 * (A1:「✓ 第五殿 · 12」)—— 选中不只靠颜色,✓ 与清除用的 × 一起说「这条筛选生效了」。
 * 选中不用匾色:匾色只有五处用法,筛选不在其中。
 *
 * Badges are never clickable; anything a user clicks to narrow a list is one of these.
 */
const base =
  "inline-flex h-7 max-sm:min-h-11 shrink-0 items-center gap-1 rounded-control border px-2 text-xs whitespace-nowrap transition-colors duration-fast ease-standard";
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
