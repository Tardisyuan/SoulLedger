"use client";

import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 分段控件(第五十七批:冤情等级、城隍级别、四十二条的如实 / 不实 / 未记)。档位少、要一眼看出选了哪一档时用它,
 * 不用下拉。与 `MfaSection` 那组同一种画法:1px 外框,选中的一段 ink 实底。
 *
 * `role="radiogroup"` 的键盘契约照做:只有选中的一段(没有选中时第一段)在 Tab 序里,左右箭头换段并选中。
 * `fill` 让各段平分整行;`tall` 每段 44px 高,拇指好点。两者传 `"narrow"` 时只在 768 以下生效(窄屏满宽、44px)。
 */
export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

export function Segmented({
  label,
  value,
  options,
  onChange,
  disabled = false,
  fill = false,
  tall = false,
  className,
  ...rest
}: {
  /** 读屏用的组名。 */
  label: string;
  value: string;
  options: readonly SegmentedOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  fill?: boolean | "narrow";
  tall?: boolean | "narrow";
  className?: string;
} & Record<`data-${string}`, string>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "border border-[oklch(var(--color-line-strong))]",
        fill ? "grid w-full grid-flow-col auto-cols-fr" : "inline-flex",
        fill === "narrow" && "md:inline-flex md:w-auto",
        className,
      )}
      {...rest}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (current < 0 && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "px-3 text-xs whitespace-nowrap disabled:cursor-default",
              tall === "narrow" ? "h-11 md:h-(--control-h-sm)" : tall ? "h-11" : "h-(--control-h-sm)",
              i > 0 && "border-l border-[oklch(var(--color-line-strong))]",
              on ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]" : "text-[oklch(var(--color-ink))]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
