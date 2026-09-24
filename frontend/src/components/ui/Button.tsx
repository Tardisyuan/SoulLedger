"use client";

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

/**
 * The one button — 规范 v1「账簿 × 卷宗」§2 的四档:
 *
 * - **主**:墨色实底、canvas 字,每屏至多一个;悬停 ink-muted,按下内阴影 + 下移 1 px。
 * - **次**(默认):无底色、区块边界线描边;悬停 surface-2,按下 surface-3。
 * - **幽**:行内、弹层里的「取消」;无边框。
 * - **危险**:次按钮的形状换成危险色 —— 规范明令「破坏性动作用次按钮 + 危险色,不用实心红」。
 *   警示同理。
 *
 * 高度固定三档:28(表格行内)、32(控件高,§1.7)、40;393 px 下一律 ≥ 44 px 点击区。
 * 禁用用 disabled-surface / disabled-ink 这一对(按设计故意低对比,WCAG 豁免),不是把
 * 活按钮调透明。焦点环交给全局 `:focus-visible`(方角 2 px 墨蓝),这里不写环。
 *
 * 历史:这个组件收拢了 190 个手写 `<button>`、141 种 className;上一版主按钮是
 * 琥珀底黑字(9.82:1),规范 v1 把强调色从按钮上撤下,只留给链接、焦点、选中。
 *
 * `type` 不默认成 "button":被替换的调用点里有真正的提交按钮,改默认会让表单静默失效。
 */

const button = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "font-medium whitespace-nowrap select-none border",
    "transition-[color,background-color,border-color,transform] duration-150 ease-out",
    // Pressed: down 1 px (规范 v1 §2 按钮 · 主「下移 1 px」), off under reduced motion.
    "active:translate-y-px motion-reduce:active:translate-y-0",
    // 393 px: every control is a ≥ 44 px target (§1.7).
    "max-sm:min-h-11",
    // Disabled is its own colour pair (disabled-surface / disabled-ink, WCAG-exempt by
    // design), not a faded copy of the live button; hover and press are dead.
    "disabled:pointer-events-none disabled:bg-[oklch(var(--color-disabled-surface))] disabled:text-[oklch(var(--color-disabled-ink))] disabled:border-[oklch(var(--color-line))]",
  ],
  {
    variants: {
      variant: {
        /** One per screen. Ink fill, canvas text; hover steps to ink-muted. */
        primary: [
          "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))] border-[oklch(var(--color-ink))]",
          "hover:bg-[oklch(var(--color-ink-muted))] hover:border-[oklch(var(--color-ink-muted))]",
          "active:shadow-[inset_0_2px_0_rgb(0_0_0/0.35)]",
        ],
        /** The default. No fill, block-line border; surface-2 on hover, surface-3 pressed. */
        secondary: [
          "bg-transparent text-[oklch(var(--color-ink))] border-[oklch(var(--color-block))]",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-surface-3))]",
        ],
        /** Inline and dialog "cancel": no border at rest. */
        ghost: [
          "bg-transparent text-[oklch(var(--color-ink-muted))] border-transparent",
          "hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]",
          "active:bg-[oklch(var(--color-surface-3))]",
        ],
        /** Destructive = the secondary button in the danger colour — never a solid red (§3.3). */
        danger: [
          "bg-transparent text-[oklch(var(--color-danger))] border-[oklch(var(--color-danger))]",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-surface-3))]",
        ],
        /** Hard to take back but not destructive: the same shape in the warning colour. */
        warning: [
          "bg-transparent text-[oklch(var(--color-warning))] border-[oklch(var(--color-warning))]",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-surface-3))]",
        ],
      },
      size: {
        /** 28 px: inside table rows. */
        sm: "h-7 px-2 text-xs",
        /** 32 px: the control height (§1.7). */
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof button>["size"]>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /**
   * Busy. Disables the control and swaps in a `<Spinner size="sm">` ahead of
   * the label, so the label stays readable and the button does not resize.
   * The spinner is unlabelled on purpose — the button's own text is already
   * the accessible name, and `aria-busy` carries the state.
   */
  loading?: boolean;
}

/**
 * `type` is deliberately NOT defaulted to "button". The 190 call sites this
 * will eventually replace include real submit buttons that rely on the native
 * default, and silently changing it during migration would break forms with no
 * type error and no failing test — the exact shape of bug this whole pass is
 * trying to remove. Callers say what they mean.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading = false, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size }), className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
});

/** Exported so the contract test can enumerate variants without restating them. */
export const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "warning"];
export const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
export { button as buttonVariants };
