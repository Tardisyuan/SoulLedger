"use client";

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

/**
 * The one button — 规范 v2「朱印」补足 A1 的按钮行,尺寸按规范 v3(44 / 48 / 56,见下面 size 那段):
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
        /**
         * 反相条上的按钮(规范 v3 `.ds-batch button`,2026-10-01):批量条是 ink 实底,
         * 条上的按钮是无框文字按钮、surface-1 字。悬停 / 按下 = surface-1 叠进 ink 12% / 24%。
         *
         * 这是唯一自己写焦点颜色的变体:全局环是 2px `--color-focus`,两档主题都等于
         * ink,外扩 2px 正好落在 ink 底上 —— 1:1,看不见。这里把环换成 surface-1
         * (对 ink 14.98 / 16.89:1),宽度、偏移仍是全局那条的。`!` 是必需的:全局规则带
         * `!important` 且不在任何 layer 里,而 layer 里的 `!important` 胜过不在 layer 里的,
         * 所以这一条赢,和选择器权重无关。只用在 ink 底上 —— 放到浅底上,环就看不见了。
         */
        inverse: [
          "bg-transparent text-[oklch(var(--color-surface-1))] border-transparent",
          "hover:bg-[color-mix(in_oklab,oklch(var(--color-surface-1))_12%,oklch(var(--color-ink)))]",
          "active:bg-[color-mix(in_oklab,oklch(var(--color-surface-1))_24%,oklch(var(--color-ink)))]",
          "focus-visible:outline-[oklch(var(--color-surface-1))]!",
        ],
        /** Hard to take back but not destructive: the secondary shape in the warning colour. */
        warning: [
          "bg-transparent text-[oklch(var(--color-warning))] border-[oklch(var(--color-warning))]",
          "hover:bg-[oklch(var(--color-surface-2))]",
          "active:bg-[oklch(var(--color-line))]",
        ],
      },
      /* 规范 v3 的三档:**44 / 48 / 56**,数字在 globals.css 的 `--control-h-*`。
       *
       * 2026-10-01 用户拍板换过去,推翻了同一天早些时候的「尺寸先整体不动」—— 当时的理由
       * (只换一部分会让全站没有统一规范)仍然成立,所以这次是**一次换全**:按钮、输入、
       * 筛选标签、分页、表格行(64px,`--table-row-h`)与各处手写的同类控件同一轮换。
       * 代价当时就写明了:`size="sm"` 约 131 处、跨约 60 个文件,大多在表格行里;一屏能看到的
       * 案卷行数变少,审判队列首当其冲。
       *
       * 最小的一档就是 44,也就是 393 宽下的触控下限,所以这里不再有 `max-sm:min-h-11`。
       *
       * 圆角仍是拍板:**按钮保持方角**。v3 的令牌表把 `--radius-control: 4px` 写成
       * 「输入与小控件」,而 v3 自己的组件库原型里 `.ds-button` 没有 border-radius。
       * 表与原型不一致,用户 2026-10-01 选了原型这一边。输入框与筛选标签是圆的
       * (`rounded-control`),按钮不是 —— 这是有意的区分,不是漏改。 */
      size: {
        /** 44 px: inside table rows (v3 行内动作列). */
        sm: "h-(--control-h-sm) px-3 text-xs",
        /** 48 px: the control height (v3 `.ds-button`). */
        md: "h-(--control-h-md) px-3 text-sm",
        /** 56 px. */
        lg: "h-(--control-h-lg) px-4 text-sm",
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
   * Busy. Disables the control and lays a `<Spinner size="sm">` over the
   * label (v3:加载时保留原宽度). The label stays in the layout and in the
   * accessibility tree — only its opacity drops to 0 — so the button keeps its
   * width and its accessible name. (This comment used to say the spinner was
   * placed ahead of the label "so the button does not resize"; inserted in the
   * flow, it widened the button by the spinner plus a gap.) The spinner is
   * unlabelled on purpose: the button's text is the name, `aria-busy` the state.
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
      className={cn(button({ variant, size }), loading && "relative", className)}
      {...rest}
    >
      {loading ? (
        <>
          {/* Same `gap-2` as the button, so the hidden label measures exactly what it did. */}
          <span data-button-label="" className="inline-flex items-center gap-2 opacity-0">
            {children}
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner size="sm" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

/** Exported so the contract test can enumerate variants without restating them. */
export const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "warning", "inverse"];
export const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
export { button as buttonVariants };
