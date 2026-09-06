"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useTheme } from "@/src/contexts/ThemeContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { X, Sun, Moon } from "lucide-react";

/**
 * The swatch and the colour it applies, as ONE fact.
 *
 * Each entry used to carry a `class` beside its `value` — `bg-amber-500` next
 * to `#f59e0b` — and the square was painted from the class while the accent
 * was set from the value. `tailwind.config.js` records what that cost: while
 * an `amber` override was in the theme, `bg-amber-500` was one step brighter
 * than `#f59e0b`, so **the square you clicked and the colour you got were
 * different**. Removing the override made them agree again, by luck rather
 * than by construction — two spellings of one colour, either of which could
 * drift.
 *
 * They are painted from `value` now. There is nothing left to disagree.
 */
const ACCENT_COLORS = [
  { name: "Amber", value: "#f59e0b" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
  { name: "Red", value: "#ef4444" },
  { name: "Rose", value: "#f43f5e" },
];

/**
 * The accent is THREE tokens, and the picker used to write one.
 *
 * `applyAccentColor` set `--color-accent` only. `--color-accent-hover` and
 * `--color-accent-ink` kept their amber values, and those are not decorative:
 * measured 2026-09-01, `--color-accent-ink` is read at **92 sites** (it is the
 * text/link accent) and `--color-accent-hover` at 10. So picking Blue turned
 * the button fills blue and left every accent heading, link and hover amber —
 * a feature that looked like it worked because the part you clicked did.
 *
 * WHY ONE WRITE WAS THE EASY MISTAKE. The drawer writes inline custom
 * properties on `documentElement`, which apply to BOTH themes at once, and
 * `--color-accent` is the one accent token declared identically in `:root` and
 * `.light` — so writing it needs no theme awareness. `--color-accent-ink` does:
 * dark declares it equal to the accent, light declares a darkened value
 * (`32 92% 31%`) because the accent itself measures 2.13:1 on white. That is
 * why the theme is a parameter here, and why the values are re-applied when
 * the theme flips.
 */
function accentTokens(hex: string, theme: string): Record<string, string> {
  const [h, sPct, lPct] = hexToHsl(hex).split(" ");
  const hue = parseInt(h, 10);
  const sat = parseInt(sPct, 10);
  const light = parseInt(lPct, 10);

  // Hover: the shipped amber pair is 50% → 58% lightness. Same step, clamped
  // so a very light accent does not hover to white.
  const hover = `${hue} ${Math.min(100, sat + 4)}% ${Math.min(72, light + 8)}%`;

  // Ink: in dark mode the accent sits on a dark surface and is already legible
  // (the stylesheet declares ink = accent there). In light mode it has to be
  // darkened until black-on-white-grade contrast is reached — solved rather
  // than guessed, against white, targeting 5.5:1 so the tenant-tinted surfaces
  // (which are darker than white) still clear the 4.5 floor. That margin is
  // the same one the shipped amber carries: 5.84 on white, 4.81 on the worst
  // tinted surface.
  const ink =
    theme === "light"
      ? `${hue} ${sat}% ${solveInkLightness(hue, sat)}%`
      : `${hue} ${sat}% ${light}%`;

  return {
    "--color-accent": `${hue} ${sat}% ${light}%`,
    "--color-accent-hover": hover,
    "--color-accent-ink": ink,
  };
}

/** Relative luminance of an `H S% L%` triple, per WCAG. */
function luminance(h: number, s: number, l: number): number {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[Math.floor(h / 60) % 6].map((v) => v + m);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The highest lightness at this hue that still clears 5.5:1 on white. */
function solveInkLightness(hue: number, sat: number): number {
  for (let l = 60; l >= 5; l -= 1) {
    const ratio = 1.05 / (luminance(hue, sat, l) + 0.05);
    if (ratio >= 5.5) return l;
  }
  return 5;
}

/** Whether black label text on this fill clears AA — primary buttons use
 *  `text-black`, so an accent that fails this makes them unreadable. */
export function accentTakesBlackText(hex: string): boolean {
  const [h, sPct, lPct] = hexToHsl(hex).split(" ");
  const lum = luminance(parseInt(h, 10), parseInt(sPct, 10), parseInt(lPct, 10));
  return (lum + 0.05) / 0.05 >= 4.5;
}

const NAV_MODE_KEY = "soulledger_nav_mode";
const ACCENT_COLOR_KEY = "soulledger_accent_color";

/** `--transition-duration-settle`, the length of both drawer keyframes. */
const MOUNT_LINGER_MS = 240;

// Convert hex to HSL string for CSS variable
function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  navMode: "classic" | "compact";
  onNavModeChange: (mode: "classic" | "compact") => void;
}

export function SettingsDrawer({ open, onClose, navMode, onNavModeChange }: SettingsDrawerProps) {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [customHex, setCustomHex] = useState("");

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
   * `MOUNT_LINGER_MS` matches `--transition-duration-settle`, which is what
   * both keyframes run at. Shorter and the drawer is cut off mid-slide.
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

  // Re-applied on theme change, not only on pick: `--color-accent-ink` is
  // theme-dependent (see `accentTokens`), and an inline custom property set
  // for one theme would be wrong in the other the moment the user flips it.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(ACCENT_COLOR_KEY);
    } catch {
      // localStorage unavailable (SSR or private browsing)
    }
    if (!saved || !/^#[0-9a-fA-F]{6}$/.test(saved)) return;
    setAccentColor(saved);
    for (const [name, value] of Object.entries(accentTokens(saved, theme))) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [theme]);

  const applyAccentColor = (color: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    setAccentColor(color);
    try {
      localStorage.setItem(ACCENT_COLOR_KEY, color);
    } catch {
      // localStorage unavailable
    }
    for (const [name, value] of Object.entries(accentTokens(color, theme))) {
      document.documentElement.style.setProperty(name, value);
    }
  };

  const [customHexError, setCustomHexError] = useState<string | null>(null);

  const handleCustomHex = () => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(customHex)) {
      setCustomHexError(t("settings.accent_hex_invalid"));
      return;
    }
    // The six presets all pass; the free-text field is the hole. Primary
    // buttons label the accent fill with `text-black` (Button.tsx settled that
    // for 47 call sites), so an accent too dark for black text makes every
    // primary button in the app unreadable — and nothing else would have
    // stopped it.
    if (!accentTakesBlackText(customHex)) {
      setCustomHexError(t("settings.accent_hex_too_dark"));
      return;
    }
    setCustomHexError(null);
    applyAccentColor(customHex);
  };

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
        className={`fixed inset-0 bg-black/50 z-drawer ${
          open ? "animate-scrim-in" : "animate-scrim-out"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        {...drawerProps}
        className={`fixed right-0 top-0 h-full w-80 bg-[hsl(var(--color-surface-1))] border-l border-[hsl(var(--color-hairline))] z-drawer shadow-xl overflow-y-auto ${
          open ? "animate-drawer-in" : "animate-drawer-out"
        }`}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 id={titleId} className="text-06 text-[hsl(var(--color-ink))]">{t("settings.title") || "Settings"}</h2>
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Theme Section */}
          <div className="mb-6">
            <h3 className="text-03 font-medium text-[hsl(var(--color-ink-muted))] mb-3">{t("settings.theme") || "Theme"}</h3>
            <div className="flex gap-2">
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 text-03 transition-colors ${
                  theme === "light"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))]"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <Sun className="w-4 h-4" />
                  {t("settings.light") || "Light"}
                </span>
              </button>
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 text-03 transition-colors ${
                  theme === "dark"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))]"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <Moon className="w-4 h-4" />
                  {t("settings.dark") || "Dark"}
                </span>
              </button>
            </div>
          </div>

          {/* Accent Color Section */}
          <div className="mb-6">
            <h3 className="text-03 font-medium text-[hsl(var(--color-ink-muted))] mb-3">{t("settings.accent_color") || "Accent Color"}</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => applyAccentColor(color.value)}
                  style={{ backgroundColor: color.value }}
                  className={`h-10 transition-colors ${
                    accentColor === color.value
                      ? "ring-2 ring-offset-2 ring-offset-surface-1 ring-[hsl(var(--color-accent))] scale-105"
                      : "hover:scale-105"
                  }`}
                  title={t(`settings.colors.${color.name.toLowerCase()}`) || color.name}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customHex}
                onChange={(e) => setCustomHex(e.target.value)}
                placeholder="#ff5500"
                className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
              />
              <button
                onClick={handleCustomHex}
                aria-describedby={customHexError ? "accent-hex-error" : undefined}
                className="px-4 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] hover:text-[hsl(var(--color-ink))] transition-colors"
              >
                {t("settings.apply") || "Apply"}
              </button>
            </div>
            {customHexError && (
              <p
                id="accent-hex-error"
                role="alert"
                className="mt-2 text-02 text-[hsl(var(--color-status-error))]"
              >
                {customHexError}
              </p>
            )}
          </div>

          {/* Navigation Mode Section */}
          <div className="mb-6">
            <h3 className="text-03 font-medium text-[hsl(var(--color-ink-muted))] mb-3">{t("settings.nav_mode") || "Navigation Mode"}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => onNavModeChange("classic")}
                className={`flex-1 py-2 px-3 text-03 transition-colors ${
                  navMode === "classic"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))]"
                }`}
              >
                {t("settings.classic") || "Classic"}
              </button>
              <button
                onClick={() => onNavModeChange("compact")}
                className={`flex-1 py-2 px-3 text-03 transition-colors ${
                  navMode === "compact"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))]"
                }`}
              >
                {t("settings.compact") || "Compact"}
              </button>
            </div>
            <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-2">
              {navMode === "compact"
                ? (t("settings.compact_desc") || "Icons only with tooltips on hover")
                : (t("settings.classic_desc") || "Full sidebar with icons and labels")}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export function useAccentColor() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACCENT_COLOR_KEY);
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) {
        document.documentElement.style.setProperty("--color-accent", hexToHsl(saved));
      } else {
        document.documentElement.style.setProperty("--color-accent", hexToHsl("#f59e0b"));
      }
    } catch {
      // localStorage unavailable (SSR or private browsing)
      document.documentElement.style.setProperty("--color-accent", hexToHsl("#f59e0b"));
    }
  }, []);
}
