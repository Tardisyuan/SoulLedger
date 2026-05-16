"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/src/contexts/ThemeContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { X, Sun, Moon } from "lucide-react";

const ACCENT_COLORS = [
  { name: "Amber", value: "#f59e0b", class: "bg-amber-500" },
  { name: "Blue", value: "#3b82f6", class: "bg-blue-500" },
  { name: "Green", value: "#22c55e", class: "bg-green-500" },
  { name: "Purple", value: "#a855f7", class: "bg-purple-500" },
  { name: "Red", value: "#ef4444", class: "bg-red-500" },
  { name: "Rose", value: "#f43f5e", class: "bg-rose-500" },
];

const NAV_MODE_KEY = "soulledger_nav_mode";
const ACCENT_COLOR_KEY = "soulledger_accent_color";

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

  useEffect(() => {
    const saved = localStorage.getItem(ACCENT_COLOR_KEY);
    if (saved) {
      setAccentColor(saved);
      document.documentElement.style.setProperty("--color-accent", hexToHsl(saved));
    }
  }, []);

  const applyAccentColor = (color: string) => {
    setAccentColor(color);
    localStorage.setItem(ACCENT_COLOR_KEY, color);
    document.documentElement.style.setProperty("--color-accent", hexToHsl(color));
  };

  const handleCustomHex = () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(customHex)) {
      applyAccentColor(customHex);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[99998]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-80 bg-[hsl(var(--color-surface-1))] border-l border-[hsl(var(--color-hairline))] z-[99998] shadow-xl overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))]">{t("settings.title") || "Settings"}</h2>
            <button
              onClick={onClose}
              className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Theme Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-[hsl(var(--color-ink-muted))] mb-3">{t("settings.theme") || "Theme"}</h3>
            <div className="flex gap-2">
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
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
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
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
            <h3 className="text-sm font-medium text-[hsl(var(--color-ink-muted))] mb-3">{t("settings.accent_color") || "Accent Color"}</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => applyAccentColor(color.value)}
                  className={`h-10 rounded-md ${color.class} transition-all ${
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
                className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
              <button
                onClick={handleCustomHex}
                className="px-4 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md text-sm text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] hover:text-[hsl(var(--color-ink))] transition-colors"
              >
                {t("settings.apply") || "Apply"}
              </button>
            </div>
          </div>

          {/* Navigation Mode Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-[hsl(var(--color-ink-muted))] mb-3">{t("settings.nav_mode") || "Navigation Mode"}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => onNavModeChange("classic")}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
                  navMode === "classic"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))]"
                }`}
              >
                {t("settings.classic") || "Classic"}
              </button>
              <button
                onClick={() => onNavModeChange("compact")}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
                  navMode === "compact"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))]"
                }`}
              >
                {t("settings.compact") || "Compact"}
              </button>
            </div>
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-2">
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
    const saved = localStorage.getItem(ACCENT_COLOR_KEY);
    if (saved) {
      document.documentElement.style.setProperty("--color-accent", hexToHsl(saved));
    } else {
      document.documentElement.style.setProperty("--color-accent", hexToHsl("#f59e0b"));
    }
  }, []);
}
