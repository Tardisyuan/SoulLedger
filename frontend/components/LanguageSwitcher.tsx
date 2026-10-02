"use client";

import { useI18n, LOCALE_LABELS, Locale } from "@/src/contexts/I18nContext";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

/** 规范 v3:控件最小 44(`--control-h-sm`),皮与其余输入框同一套 `fieldControl`。此前是 py-1.5 的约 30 高、s2 底。 */
const SELECT = cn(fieldControl({ size: "sm" }), "w-auto cursor-pointer");

export function LanguageSwitcher() {
  const { locale, setLocale, hydrated, t } = useI18n();

  if (!hydrated) {
    // Placeholder for the pre-hydration render. Disabled so it can't be
    // operated before setLocale is wired up, and hidden from assistive tech
    // since the real control replaces it a tick later.
    return (
      <select
        disabled
        aria-hidden="true"
        tabIndex={-1}
        className={SELECT}
      >
        <option>—</option>
      </select>
    );
  }

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={t("nav.language")}
      className={SELECT}
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
