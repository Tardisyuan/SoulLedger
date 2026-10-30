"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ICON_CATEGORIES } from "@/src/components/ui/iconCatalog";
import { staticMenuIcon } from "@/src/lib/menuIcons";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
}

/*
 * The amber literals here meant "the accent" and were spelled as a fixed
 * colour. Two consequences: `text-amber-400` is one step off the accent and
 * near-invisible on light surfaces, and none of the three followed the accent
 * the user picks in SettingsDrawer — choose Blue and the icon picker stayed
 * amber. They are accent tokens now, so they track the choice.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("navigation");
  const [search, setSearch] = useState("");

  // Resolve the stored name the same way MenuRowCells does — by export name,
  // not by `displayName`. In lucide-react 1.x an alias export (e.g. the
  // "BarChart" / "Building2" rows seeded by menus 0009) is the *same* component
  // as its canonical icon, so its displayName is the canonical name
  // ("ChartNoAxesColumnIncreasing"); a displayName match would lose the preview
  // and the selected ring for every row stored under an older name.
  // The static table (picker whitelist + every name the menus migrations seed), not the whole of
  // lucide: `import * as` with a computed key put all of it into the menus page.
  const SelectedIcon: LucideIcon | null = staticMenuIcon(value);

  // Search across all icons
  const searchResults = search
    ? ICON_CATEGORIES.flatMap((c) => c.icons).filter((icon) =>
        icon.displayName?.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const displayCategory = ICON_CATEGORIES.find((c) => c.label === activeCategory);
  // Aliases collapse to one component (Home/House, Layout/PanelsTopLeft,
  // Trash/Trash2), so dedupe by identity — the grid is keyed by displayName.
  const displayIcons = [...new Set(search ? searchResults : (displayCategory?.icons ?? []))];

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[oklch(var(--color-surface-2))] border border-[oklch(var(--color-hairline))] text-sm text-[oklch(var(--color-ink))] hover:border-[oklch(var(--color-accent))] transition-colors min-w-[120px]"
        >
          {SelectedIcon ? (
            <SelectedIcon className="w-4 h-4 text-[oklch(var(--color-accent-ink))]" />
          ) : (
            <span className="text-[oklch(var(--color-ink-muted))]">{t("icon_picker.select")}</span>
          )}
          {value && <span className="text-[oklch(var(--color-ink-subtle))] ml-auto text-xs">{value}</span>}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-status-error))] text-xs"
          >
            {t("icon_picker.clear")}
          </button>
        )}
      </div>

      <BaseModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setSearch(""); }}
        title={t("icon_picker.select")}
      >
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("icon_picker.search")}
            aria-label={t("icon_picker.search")}
            className="w-full bg-[oklch(var(--color-surface-2))] border border-[oklch(var(--color-hairline))] px-3 py-2 text-sm text-[oklch(var(--color-ink))] focus:outline-hidden focus:border-[oklch(var(--color-accent))]"
          />

          {!search && (
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {ICON_CATEGORIES.map((cat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => setActiveCategory(cat.label)}
                  className={`px-2 py-1 text-xs transition-colors ${
                    activeCategory === cat.label
                      ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                      : "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
                  }`}
                >
                  {t(`icon_picker.categories.${cat.label}`)}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto">
            {displayIcons.map((icon) => {
              const isSelected = icon === SelectedIcon;
              return (
                <button
                  key={icon.displayName}
                  type="button"
                  onClick={() => {
                    if (icon.displayName) onChange(icon.displayName);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  title={icon.displayName ?? ""}
                  aria-label={icon.displayName ?? t("icon_picker.select")}
                  className={`flex items-center justify-center w-9 h-9 transition-colors ${
                    isSelected
                      ? "bg-[oklch(var(--color-accent)/0.2)] text-[oklch(var(--color-accent-ink))] ring-1 ring-[oklch(var(--color-accent))]"
                      : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]"
                  }`}
                >
                  {(() => {
                    const Icon = icon as LucideIcon;
                    return <Icon className="w-4 h-4" />;
                  })()}
                </button>
              );
            })}
          </div>

          {displayIcons.length === 0 && (
            <p className="text-center text-[oklch(var(--color-ink-muted))] text-sm py-4">{t("icon_picker.no_results")}</p>
          )}
        </div>
      </BaseModal>
    </>
  );
}
