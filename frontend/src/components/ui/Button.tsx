"use client";

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one button — 规范 v2「朱印」补足 A1 的按钮行,尺寸见下面 size 那段(触屏 44 / 48 / 56,精确指针 v4 的 32 / 36 / 40),
 * 圆角是控件那一档 4px(`rounded-control`,规范 v4,用户 2026-11-06):
 *
 * - **主**:墨色实底(第三十批「卷宗」第 1 步,Design v4 第三十批第五节第 1 条):`--main-fill` = ink,
 *   字是 canvas,无边框。此前是文明的 solid(`--color-main`)配白字;主按钮每一页都有,用文明色就破了
 *   「文明色只在顶线、印、脊、焦点四处」那条规矩。按钮字与键帽不加透明度。悬停 / 按下 = 这一底色再叠黑
 *   12% / 24%(`color-mix(… 88% / 76%, black)`)。
 * - **次**(默认)= A1 的「幽灵」:无底色、1px ink3 描边、ink 字;悬停 s2,按下 line。
 * - **幽**:行内、弹层里的「取消」;同上但无边框。
 * - **危险**:neg.strong 实底、白字,悬停 / 按下同样叠黑。A1:永远带 ✕ 和动作文字,
 *   只出现在「输入名称以确认」的对话框里 —— 放在哪是调用点的事,这里只管长相。
 * - **警示**:次按钮的形状换成警示色(A1 没画这一档,保留 v1 的做法)。
 *
 * 禁用:底 s2、字 ink3、边框透明,不透明度不变(对比豁免,但仍可辨认)。忙碌(第五十八批 M10):aria-busy、
 * 立即不可再按,但样子不变 —— 不置灰(禁用的那组类带 `not-aria-busy:`),文字、宽度都不动;超过 160ms 底边走一条线
 * (globals.css `.button-busy`)。不放转圈。焦点环交给全局 `:focus-visible`(2px ink 外扩 2)。
 *
 * 叠黑的类名必须整串写出来:Tailwind 扫源码里的完整类名,拼出来的它看不见。
 *
 * `type` 不默认成 "button":被替换的调用点里有真正的提交按钮,改默认会让表单静默失效。
 */

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-control",
    "font-semibold whitespace-nowrap select-none border",
    "transition-[color,background-color,border-color] duration-fast ease-standard",
    // Disabled (A1): s2 fill, ink3 text, no border, same opacity; hover and press are dead.
    // Busy is disabled too (no second press) but keeps its look (M10), hence `not-aria-busy:`.
    "disabled:pointer-events-none disabled:not-aria-busy:bg-[oklch(var(--color-disabled-surface))] disabled:not-aria-busy:text-[oklch(var(--color-disabled-ink))] disabled:not-aria-busy:border-transparent",
  ],
  {
    variants: {
      variant: {
        /** One per screen. Ink fill, canvas text (第三十批: the civilization colour left the button). */
        primary: [
          "bg-(--main-fill) text-[oklch(var(--color-canvas))] border-transparent",
          "hover:bg-[color-mix(in_oklab,var(--main-fill)_88%,black)]",
          "active:bg-[color-mix(in_oklab,var(--main-fill)_76%,black)]",
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
        /** Destructive (A1 危险): solid neg.strong, its own text colour (v4 onNeg: dark text in dark, white in light; 用户 2026-11-06). */
        danger: [
          "bg-[oklch(var(--color-danger-strong))] text-[oklch(var(--color-on-danger))] border-transparent",
          "hover:bg-[color-mix(in_oklab,oklch(var(--color-danger-strong))_88%,var(--danger-shade))]",
          "active:bg-[color-mix(in_oklab,oklch(var(--color-danger-strong))_76%,var(--danger-shade))]",
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
      /* 三档高度,数字在 globals.css 的 `--control-h-*`:触屏 **44 / 48 / 56**(规范 v3,2026-10-01 起;
       * 最小一档就是 393 宽下的触控下限,所以这里没有 `max-sm:min-h-11`),鼠标等精确指针 **32 / 36 / 40**
       * (规范 v4,用户 2026-11-07;md 即 v4 的「控件 36」)。表格行同理:触屏 64、精确指针 46(`--table-row-h`)。
       *
       * 圆角:v3 时按钮是方角(2026-10-01 用户选了 v3 原型那一边);规范 v4(用户 2026-11-06)定
       * 「控件 4、面板与弹层 6」,按钮属于控件,于是和输入框、筛选标签同为 `rounded-control`。 */
      size: {
        /** Touch 44 / fine pointer 32: inside table rows (行内动作列). */
        sm: "h-(--control-h-sm) px-3 text-xs",
        /** Touch 48 / fine pointer 36: the control height (v4 控件 36). */
        md: "h-(--control-h-md) px-3 text-sm",
        /** Touch 56 / fine pointer 40. */
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
   * Busy (Design v4 batch 58 M10). Disabled at once so it cannot be pressed again, but drawn as before: same
   * label, same width, same colours. After 160ms a 2px line runs along the bottom edge (`.button-busy`), in the
   * button's own text colour at 60%. The label is the accessible name, `aria-busy` the state — nothing else is read.
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
      className={cn(button({ variant, size }), loading && "relative overflow-hidden", className)}
      {...rest}
    >
      {children}
      {loading ? <span aria-hidden="true" data-button-busy="" className="button-busy" /> : null}
    </button>
  );
});

/** Exported so the contract test can enumerate variants without restating them. */
export const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "warning", "inverse"];
export const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
export { button as buttonVariants };
