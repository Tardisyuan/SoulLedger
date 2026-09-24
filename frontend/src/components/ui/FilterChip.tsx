"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 筛选签(规范 v1 §2「核心原语」). A 28 px chip with a 1 px structure line.
 * Hover surface-2, pressed surface-3; **in effect** = block line + surface-2 +
 * a 2 px accent underline, plus a × that clears it — the underline and the ×
 * together, so "this filter is on" never rests on colour alone.
 *
 * Badges are never clickable (§2 徽章); anything a user clicks to narrow a list
 * is one of these.
 */
const base =
  "inline-flex h-7 max-sm:min-h-11 shrink-0 items-center gap-1 border px-2 text-xs whitespace-nowrap transition-colors duration-150 ease-out";
const idle =
  "border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] active:bg-[oklch(var(--color-surface-3))]";
const on =
  "border-[oklch(var(--color-block))] bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink))] shadow-[inset_0_-2px_0_oklch(var(--color-accent))] active:bg-[oklch(var(--color-surface-3))]";

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
    <span data-filter-chip="" data-active={active || undefined} className={cn(filterChipClass(active), disabled && "text-[oklch(var(--color-disabled-ink))]")}>
      <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">{label} ·</span>
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
          className="text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]"
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
      className={cn(filterChipClass(pressed), "disabled:text-[oklch(var(--color-disabled-ink))] disabled:cursor-not-allowed")}
    >
      {children}
      {pressed && <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">×</span>}
    </button>
  );
}
