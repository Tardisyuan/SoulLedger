"use client";

import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { ExternalLink } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTheme } from "@/src/contexts/ThemeContext";

export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useTenant();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header with logo */}
      <header className="h-16 border-b border-[hsl(var(--color-hairline))] flex items-center px-6">
        <div className="flex items-center gap-2">
          <svg className="w-7 h-7 text-[hsl(var(--color-accent))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5M5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
          </svg>
          <span className="text-[hsl(var(--color-accent))] font-bold">SoulLedger</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />

          <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors p-1 rounded"
          >
            {theme === "dark" ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />

          {/* Console button - styled as accent button */}
          {user ? (
            <a
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t("home.console")}
              <ExternalLink className="w-4 h-4" />
            </a>
          ) : (
            <a
              href="/login"
              className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t("home.console")}
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-12 md:py-16 lg:py-24">
        <header className="text-center mb-12 md:mb-16 lg:mb-24">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 text-[hsl(var(--color-accent))]">
            {t("home.hero_title")}
          </h1>
          <p className="text-[hsl(var(--color-accent))]/80 text-base md:text-lg lg:text-xl mb-2">{t("home.hero_subtitle")}</p>
          <p className="text-[hsl(var(--color-ink-subtle))] text-sm md:text-base max-w-2xl mx-auto">
            {t("home.hero_description")}
          </p>
        </header>

        <section>
          <h2 className="text-xl md:text-2xl lg:text-3xl font-semibold text-center mb-6 md:mb-8 lg:mb-12 text-[hsl(var(--color-ink-muted))]">
            {t("home.civilizations_title")}
          </h2>
          <div className="grid md:grid-cols-3 gap-4 md:gap-6 lg:gap-8 max-w-4xl mx-auto">
            <CivilizationCard
              title={t("home.chinese_title")}
              subtitle={t("home.chinese_subtitle")}
              description={t("home.chinese_desc")}
            />
            <CivilizationCard
              title={t("home.european_title")}
              subtitle={t("home.european_subtitle")}
              description={t("home.european_desc")}
            />
            <CivilizationCard
              title={t("home.egyptian_title")}
              subtitle={t("home.egyptian_subtitle")}
              description={t("home.egyptian_desc")}
              isEgyptian
            />
          </div>
        </section>

        {/* Footer with version */}
        <div className="mt-12 md:mt-16 lg:mt-24 text-center">
          {locale === "zh-Hans" && (
            <p className="text-[hsl(var(--color-ink-subtle))] text-sm">
              万古轮回皆有录
            </p>
          )}
          {locale === "en" && (
            <p className="text-[hsl(var(--color-ink-subtle))] text-sm italic">
              Every soul weighed, every life recorded
            </p>
          )}
          {locale === "egy" && (
            <p
              className="text-[hsl(var(--color-accent))] text-xs"
              style={{ fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }}
            >
              𓇳 𓋹 𓎛 𓃭
            </p>
          )}
          <p className="text-[hsl(var(--color-ink-subtle))] text-sm mt-1">
            SoulLedger v0.1
          </p>
        </div>
      </main>
    </div>
  );
}

function CivilizationCard({
  title,
  subtitle,
  description,
  isEgyptian,
}: {
  title: string;
  subtitle: string;
  description: string;
  isEgyptian?: boolean;
}) {
  return (
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 md:p-6 h-full flex flex-col">
      <p
        className="text-xl md:text-2xl font-bold mb-1"
        style={
          isEgyptian
            ? { fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }
            : undefined
        }
      >
        {title}
      </p>
      <p className="text-xs md:text-sm text-[hsl(var(--color-ink-muted))] mb-3 md:mb-4">{subtitle}</p>
      <p className="text-[hsl(var(--color-ink))] text-sm leading-relaxed">{description}</p>
    </div>
  );
}
