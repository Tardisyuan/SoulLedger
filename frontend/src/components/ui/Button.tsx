"use client";

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

/**
 * The one button — 规范 v2「朱印」补足 A1 的按钮行(Web 高 32、字 13 / 600):
 *
 * - **主**:匾色实底(`--color-main`,按 <html data-civ> 换文明)、onMain 字、无边框。
 *   主按钮是匾色的五处用法之一,只给落判这一类决定。悬停 / 按下 = 底色叠黑 12% / 24%
 *   (`color-mix(… 88% / 76%, black)`),对比只升不降。
 * - **次**(默认)= A1 的「幽灵」:无底色、1px ink3 描边、ink 字;悬停 s2,按下 line。
 * - **幽**:行内、弹层里的「取消」;同上但无边框。
 * - **危险**:neg.strong 实底、白字,悬停 / 按下同样叠黑。A1:永远带 ✕ 和动作文字,
 *   只出现在「输入名称以确认」的对话框里 —— 放在哪是调用点的事,这里只管长相。
 * - **警示**:次按钮的形状换成警示色(A1 没画这一档,保留 v1 的做法)。
 *
 * 禁用:底 s2、字 ink3、边框透明,不透明度不变(对比豁免,但仍可辨认)。加载:aria-busy、
 * 不可再按、前面加转圈,宽度不变。焦点环交给全局 `:focus-visible`(2px ink 外扩 2)。
 *
 * 叠黑的类名必须整串写出来:Tailwind 扫源码里的完整类名,拼出来的它看不见。
 *
 * `type` 不默认成 "button":被替换的调用点里有真正的提交按钮,改默认会让表单静默失效。
 */

const button = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "font-semibold whitespace-nowrap select-none border",
    "transition-[color,background-color,border-color] duration-fast ease-standard",
    // 393 px: every control is a ≥ 44 px target.
    "max-sm:min-h-11",
    // Disabled (A1): s2 fill, ink3 text, no border, same opacity; hover and press are dead.
    "disabled:pointer-events-none disabled:bg-[oklch(var(--color-disabled-surface))] disabled:text-[oklch(var(--color-disabled-ink))] disabled:border-transparent",
  ],
  {
    variants: {
      variant: {
        /** One per screen. The civilization's plaque colour, onMain text. */
        primary: [
          "bg-[oklch(var(--color-main))] text-[oklch(var(--color-on-main))] border-transparent",
          "hover:bg-[color-mix(in_oklab,oklch(var(--color-main))_88%,black)]",
          "active:bg-[color-mix(in_oklab,oklch(var(--color-main))_76%,black)]",
        ],
        /** The default (A1 幽灵). No fill, ink3 border; s2 on hover, line pressed. */
        secondary: [
          "bg-transparent text-[oklch(var(--color-ink))] border-[oklch(var(--color-line-strong))]",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-line))]",
        ],
        /** Inline and dialog "cancel": no border at rest. */
        ghost: [
          "bg-transparent text-[oklch(var(--color-ink))] border-transparent",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-line))]",
        ],
        /** Destructive (A1 危险): solid neg.strong, white text. */
        danger: [
          "bg-[oklch(var(--color-danger-strong))] text-white border-transparent",
          "hover:bg-[color-mix(in_oklab,oklch(var(--color-danger-strong))_88%,black)]",
          "active:bg-[color-mix(in_oklab,oklch(var(--color-danger-strong))_76%,black)]",
        ],
        /** Hard to take back but not destructive: the secondary shape in the warning colour. */
        warning: [
          "bg-transparent text-[oklch(var(--color-warning))] border-[oklch(var(--color-warning))]",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-line))]",
        ],
      },
      /* 规范 v3 的三档是 **44 / 48 / 56**,这里仍然是 28 / 32 / 40,**是拍板不是欠账**。
       *
       * 用户 2026-10-01 决定:尺寸先整体不动,等真跑起来觉得太紧凑再一次性换到 v3。
       * 理由是只换一部分(比如表单换、表格不换)会让全站没有统一规范 —— 半套尺寸
       * 比旧的一整套更糟。
       *
       * 换的时候要知道代价:`size="sm"` 有 131 处、跨 60 个文件,绝大多数在表格行内。
       * v3 的表格行是 `min-height: 64px`(它的 `.queue-row`),行内动作列 44px;
       * 这里现在约 40px。换过去一屏能看到的案卷行数会明显变少,审判队列首当其冲。
       * 所以那是一次连表格行高一起做的改版,不是把三个数字改掉就完了。
       *
       * 圆角同样是拍板:**按钮保持方角**。v3 的令牌表把 `--radius-control: 4px` 写成
       * 「输入与小控件」,而 v3 自己的组件库原型里 `.ds-button` 没有 border-radius。
       * 表与原型不一致,用户 2026-10-01 选了原型这一边。输入框与筛选标签是圆的
       * (`rounded-control`),按钮不是 —— 这是有意的区分,不是漏改。 */
      size: {
        /** 28 px: inside table rows. (v3: 44) */
        sm: "h-7 px-2 text-xs",
        /** 32 px: the control height (A1). (v3: 48) */
        md: "h-8 px-3 text-sm",
        /** 40 px. (v3: 56) */
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
