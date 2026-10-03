/**
 * The three class strings a bottom-rule tab is made of — written once, for the
 * six strips that draw one.
 *
 * WHY IT IS A FILE, AND WHY THE ARITHMETIC IS NOT THE ARGUMENT. The saving is
 * about fourteen lines, which is no reason to add a module. The reason is that
 * the sixth copy had already started to drift: `app/notifications/page.tsx`
 * reached for exactly this abstraction on its own, named the same three
 * constants — and REORDERED the active/inactive strings while doing it
 * (`border-… text-…` where the five inline copies wrote `text-… border-…`).
 * Same rendered result, independently reformatted. That is the state
 * `CIVILIZATION_ICONS` was found in (commit 1f68be0): values still equal,
 * spelling already diverged, which is the moment before the values diverge
 * too.
 *
 * The live risk is not hypothetical. `TAB_ON` names `--color-accent-ink`, and
 * the accent/accent-ink split is the one this codebase keeps getting wrong in
 * one place at a time (globals.css's own token note, `Badge.tsx:70-74`,
 * `app/welcome/page.tsx:134-138`, and the masthead hovers fixed alongside this
 * change). With six copies, correcting one leaves five disagreeing and nothing
 * goes red.
 *
 * WHY CONSTANTS AND NOT A `<Tabs>` COMPONENT. The six strips do not share a
 * structure, only a recipe. Three map an array into `PageShell`'s `tabs` slot,
 * one of those wraps a single item in `RequireAdmin`, one writes two buttons by
 * hand into the page BODY on purpose, and one drives a two-value filter. A
 * component would fit three of them and be fought by the other three — and a
 * component with a `tabs`-shaped API would actively invite someone to move
 * `app/workflow/[id]/page.tsx`'s strip into `PageShell`'s slot, which the
 * paragraph above that strip spends nine lines explaining must not happen (its
 * tabs partition the bottom half of the page, not the page). Constants change
 * no call site's structure and carry no such invitation.
 *
 * WHY THESE ARE PLAIN <button>s AND NOT `Button`. Stated here once instead of
 * at each strip: `Button` ships primary / secondary / ghost / danger, and a tab
 * is none of the four. Its cva base writes `border` on all four sides plus an
 * `active:translate-y-px` press nudge, both of which fight a control whose
 * entire visual language is a single 2px bottom rule that has to line up with
 * its container's hairline — so a tab built on it would spend its className
 * undoing the base it inherited.
 *
 * WHY THE COLOURS ARE SPELLED `text-[oklch(var(--color-ink))]` AND NEVER
 * `text-ink`: tailwind.config.js declares no such colour, so the shorthand
 * generates no CSS at all and nothing errors. See
 * `src/__tests__/cssTokenReferenceContract.test.ts`.
 */

/**
 * Geometry and type, identical in both states. v3:点击区至少 44(`--control-h-sm`)。
 * 此前 py-2 + text-sm 约 38 高。`inline-flex items-center justify-center` 让多出的高度
 * 平分在字的上下(`<Link>` 也吃得到 min-h),下划线仍是元素底边那 2px。
 */
export const TAB_BASE = "inline-flex min-h-(--control-h-sm) items-center justify-center px-4 py-2 text-sm transition-colors duration-fast border-b-2 -mb-px";

/**
 * The selected tab. `--color-accent-ink`, NOT `--color-accent`: this is text,
 * and in light mode the bare accent (`38 92% 50%`) measures 2.13:1 on canvas.
 * The 2px rule underneath is a non-text mark and keeps the fill token.
 */
/** 规范 v2 A1「标签页 · 当前」:ink 字、600、2px ink 下划线。v2 没有强调色,选中就是墨。 */
export const TAB_ON = "text-[oklch(var(--color-ink))] font-semibold border-[oklch(var(--color-ink))]";

/** The unselected tabs: muted ink, no rule, hovering up to full ink. */
/** A1「常态 / 悬停 / 禁用」:ink2 字;悬停 ink 字 + ink3 下划线;禁用 ink3、不可点。 */
export const TAB_OFF =
  "text-[oklch(var(--color-ink-muted))] border-transparent hover:text-[oklch(var(--color-ink))] hover:border-[oklch(var(--color-line-strong))] disabled:cursor-not-allowed disabled:text-[oklch(var(--color-ink-subtle))] disabled:hover:border-transparent";
