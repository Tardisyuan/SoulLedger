"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/src/contexts/ThemeContext";

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

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  navMode: "classic" | "compact";
  onNavModeChange: (mode: "classic" | "compact") => void;
}

export function SettingsDrawer({ open, onClose, navMode, onNavModeChange }: SettingsDrawerProps) {
  const { theme, toggleTheme } = useTheme();
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [customHex, setCustomHex] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(ACCENT_COLOR_KEY);
    if (saved) {
      setAccentColor(saved);
    }
  }, []);

  const applyAccentColor = (color: string) => {
    setAccentColor(color);
    localStorage.setItem(ACCENT_COLOR_KEY, color);
    document.documentElement.style.setProperty("--color-accent", color);
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
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-80 bg-surface-1 border-l border-hairline z-50 shadow-xl overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-ink">Settings</h2>
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-ink transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Theme Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-ink-muted mb-3">Theme</h3>
            <div className="flex gap-2">
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
                  theme === "light"
                    ? "bg-amber-500 text-black"
                    : "bg-surface-2 text-ink-muted hover:bg-surface-3"
                }`}
              >
                Light
              </button>
              <button
                onClick={toggleTheme}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
                  theme === "dark"
                    ? "bg-amber-500 text-black"
                    : "bg-surface-2 text-ink-muted hover:bg-surface-3"
                }`}
              >
                Dark
              </button>
            </div>
          </div>

          {/* Accent Color Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-ink-muted mb-3">Accent Color</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => applyAccentColor(color.value)}
                  className={`h-10 rounded-md ${color.class} transition-all ${
                    accentColor === color.value
                      ? "ring-2 ring-offset-2 ring-offset-surface-1 ring-amber-400 scale-105"
                      : "hover:scale-105"
                  }`}
                  title={color.name}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customHex}
                onChange={(e) => setCustomHex(e.target.value)}
                placeholder="#ff5500"
                className="flex-1 bg-surface-2 border border-hairline rounded-md px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleCustomHex}
                className="px-4 py-2 bg-surface-2 border border-hairline rounded-md text-sm text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors"
              >
                Apply
              </button>
            </div>
          </div>

          {/* Navigation Mode Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-ink-muted mb-3">Navigation Mode</h3>
            <div className="flex gap-2">
              <button
                onClick={() => onNavModeChange("classic")}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
                  navMode === "classic"
                    ? "bg-amber-500 text-black"
                    : "bg-surface-2 text-ink-muted hover:bg-surface-3"
                }`}
              >
                Classic
              </button>
              <button
                onClick={() => onNavModeChange("compact")}
                className={`flex-1 py-2 px-3 rounded-md text-sm transition-colors ${
                  navMode === "compact"
                    ? "bg-amber-500 text-black"
                    : "bg-surface-2 text-ink-muted hover:bg-surface-3"
                }`}
              >
                Compact
              </button>
            </div>
            <p className="text-xs text-ink-subtle mt-2">
              {navMode === "compact"
                ? "Icons only with tooltips on hover"
                : "Full sidebar with icons and labels"}
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
      document.documentElement.style.setProperty("--color-accent", saved);
    } else {
      document.documentElement.style.setProperty("--color-accent", "#f59e0b");
    }
  }, []);
}
