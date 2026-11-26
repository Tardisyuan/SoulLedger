"use client";

import { cn } from "@/lib/utils";

/**
 * 开关(规范 v2 A1,v4 沿用):点击区 `--control-h-sm`(触屏 44、精确指针 32),里面画 32 × 18 的轨道、1.5px 框。
 * 开 = ink 实底、纸色滑块在右;关 = 空底、line-strong 框与滑块在左;禁用 = disabled-surface 底、line 框
 * (不调透明度);不用强调色 —— 强调色指向 ink,开时滑块与底同色、整块一片(2026-09-30 用户截图)。
 *
 * 禁用写 `aria-disabled` 而不是 `disabled`:按钮仍可聚焦,`describedBy` 指向的「为什么灰」读屏器读得到。
 * 带 `children` 时文字跟在轨道右边(租户 MFA 的「要求 / 不要求」),点击区随内容变宽。
 */
export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
  describedBy,
  children,
  className,
}: {
  checked: boolean;
  /** 读屏器念的名字(`aria-label`)。 */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "inline-flex shrink-0 items-center",
        children
          ? "min-h-(--control-h-sm) gap-2 text-xs text-[oklch(var(--color-ink))]"
          : "size-(--control-h-sm) justify-center",
        disabled && "cursor-not-allowed",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-[18px] w-8 items-center border-[1.5px] p-0.5 transition-colors duration-instant",
          checked ? "justify-end" : "justify-start",
          disabled
            ? "border-[oklch(var(--color-line))] bg-[oklch(var(--color-disabled-surface))]"
            : checked
              ? "border-[oklch(var(--color-ink))] bg-[oklch(var(--color-ink))]"
              : "border-[oklch(var(--color-line-strong))] bg-transparent",
        )}
      >
        <span
          className={cn(
            "block size-[11px]",
            checked && !disabled ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-line-strong))]",
          )}
        />
      </span>
      {children}
    </button>
  );
}
