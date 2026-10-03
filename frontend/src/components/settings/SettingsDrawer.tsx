"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useTheme } from "@/src/contexts/ThemeContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { X, Sun, Moon } from "lucide-react";

/*
 * 规范 v2 撤掉了「用户自选强调色」(2026-09-30 拍板,不加替代开关):v2 没有强调色,
 * 选中、链接、焦点都是墨,文明只进匾色。这里原有的色板、自定义 hex 输入、以及
 * 挂载时把 `soulledger_accent_color` 写回 `--color-accent` 的 `useAccentColor`
 * 一并删除 —— 旧用户 localStorage 里存着的那个值从此没有任何代码去读,等于被忽略。
 */

/** `--transition-duration-settle` (规范 v2 base 200), the length of both drawer keyframes. */
const MOUNT_LINGER_MS = 180;

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

/*
 * 「导航模式 · 经典 / 紧凑」也撤掉了(规范 v2):v1 的 200px 侧栏与 56px 编号栏换成了立柱。
 * localStorage 里旧的 `soulledger_nav_mode`(下划线)从此没有代码读。规范 v3 的导航展开 / 收起
 * 不在设置里:它是工具条上的按钮与 `[`,存在 `soulledger-nav-mode`(连字符,见 GlobalNav.tsx)。
 */
export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();

  // The drawer's name comes from the heading it already renders, not from a
  // second copy of the same string: `aria-labelledby` cannot drift from what
  // is on screen, an `aria-label` beside an `<h2>` can. Declared above the
  // `open` early-return because hooks cannot be conditional.
  const titleId = useId();
  const { drawerRef, drawerProps } = useDrawerA11y<HTMLDivElement>({
    open,
    onClose,
    labelledBy: titleId,
  });

  /**
   * MOUNTED A LITTLE LONGER THAN IT IS OPEN, which is the whole of the exit.
   *
   * This was `if (!open) return null`, so the drawer was inserted and deleted
   * and had neither an entrance nor a departure — there is nothing for CSS to
   * tween across a mount. Keeping it in the tree for the length of the slide
   * gives the exit somewhere to happen.
   *
   * WHY NOT KEEP IT MOUNTED ALWAYS AND HIDE IT. That was the first attempt,
   * with `visibility: hidden`, and it is wrong here for a reason particular to
   * this repository: it would make "a closed drawer is not focusable and not
   * announced" — a panel full of controls — a guarantee carried entirely by a
   * Tailwind class. jsdom does not resolve classes to computed styles, so no
   * test here could ever check it, and
   * `src/__tests__/SettingsDrawer.test.tsx`'s "renders nothing when open is
   * false" would have had to be weakened into an assertion about a class name.
   * A closed drawer stays genuinely absent from the DOM; it is only late in
   * leaving.
   *
   * `MOUNT_LINGER_MS` matches `--transition-duration-close` (规范 v3: 关 180),
   * which is what both exit keyframes run at. Shorter and the drawer is cut off
   * mid-slide.
   */
  const [closing, setClosing] = useState(false);
  // DERIVED DURING RENDER, not set from an effect — and that is load-bearing.
  //
  // The first version of this held `present` in state and turned it on from an
  // effect. That mounts the drawer one commit LATE, and `useDrawerA11y`'s
  // "way in" effect runs on the commit where `open` became true: it read
  // `drawerRef.current`, found null because the drawer was not in the tree
  // yet, and moved focus nowhere. `drawerFocusTrap.test.tsx` caught it —
  // "moves focus in, closes on Escape, and gives it back to the gear" — which
  // is why that test is worth more than the animation it was guarding against.
  const present = open || closing;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setClosing(false);
      return;
    }
    // Only linger on a real close. Without this the drawer would linger once on
    // mount, having never been open.
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setClosing(true);
    const timer = setTimeout(() => setClosing(false), MOUNT_LINGER_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!present) return null;

  return (
    <>
      {/* Backdrop. A `<button>`, for the same reason AppLayout's scrim is one:
          it carries a click handler, so it is a control and should say so.
          Escape is the keyboard's way out; the trap keeps Tab inside the
          drawer, so this never becomes a stray tab stop while it is open. */}
      <button
        type="button"
        aria-label={t("common.close")}
        data-motion="fade"
        className={`fixed inset-0 bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] z-drawer ${
          open ? "animate-scrim-in" : "animate-scrim-out"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        {...drawerProps}
        data-motion="fade"
        className={`fixed right-0 top-0 h-full w-80 bg-[oklch(var(--color-surface-1))] border-l border-[oklch(var(--color-ink))] z-drawer overflow-y-auto ${
          open ? "animate-drawer-in" : "animate-drawer-out"
        }`}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 id={titleId} className="text-lg text-[oklch(var(--color-ink))]">{t("settings.title") || "Settings"}</h2>
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Theme Section */}
          <div className="mb-6">
            <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-muted))] mb-3">{t("settings.theme") || "Theme"}</h3>
            <div className="flex gap-2">
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 text-sm transition-colors ${
                  theme === "light"
                    ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                    : "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-3))]"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <Sun className="w-4 h-4" />
                  {t("settings.light") || "Light"}
                </span>
              </button>
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 text-sm transition-colors ${
                  theme === "dark"
                    ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                    : "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-3))]"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <Moon className="w-4 h-4" />
                  {t("settings.dark") || "Dark"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
