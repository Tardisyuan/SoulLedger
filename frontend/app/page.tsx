"use client";

import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import Link from "next/link";
import { ExternalLink, LogIn } from "lucide-react";

export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useTenant();

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header with logo */}
      <header className="h-16 border-b border-hairline flex items-center px-6">
        <div className="flex items-center gap-2">
          <svg className="w-7 h-7 text-[hsl(var(--color-accent))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5M5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
          </svg>
          <span className="text-[hsl(var(--color-accent))] font-bold">SoulLedger</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Console button */}
          {user ? (
            <a
              href="/dashboard"
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              控制台
            </a>
          ) : (
            <a
              href="/login"
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              控制台
            </a>
          )}

          {!user && (
            <Link
              href="/login"
              className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <LogIn className="w-4 h-4" />
              登录
            </Link>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-16">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 text-[hsl(var(--color-accent))]">
            {t("home.hero_title")}
          </h1>
          <p className="text-[hsl(var(--color-accent))]/80 text-lg mb-2">{t("home.hero_subtitle")}</p>
          <p className="text-[hsl(var(--color-ink-subtle))] text-sm max-w-2xl mx-auto">
            {t("home.hero_description")}
          </p>
        </header>

        <section>
          <h2 className="text-2xl font-semibold text-center mb-8 text-[hsl(var(--color-ink-muted))]">
            {t("home.civilizations_title")}
          </h2>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
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
        <div className="mt-16 text-center">
          <p className="text-[hsl(var(--color-ink-subtle))] text-sm">
            SoulLedger v0.1
          </p>
          {locale === "egy" && (
            <p
              className="text-[hsl(var(--color-accent))] text-xs mt-1"
              style={{ fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }}
            >
              𓂀 𓋴 𓍯 𓂋 𓃀 𓆗 𓎛 𓃭 𓋹 𓋴 𓆗
            </p>
          )}
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
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-6 h-full">
      <p
        className="text-2xl font-bold mb-1"
        style={
          isEgyptian
            ? { fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }
            : undefined
        }
      >
        {title}
      </p>
      <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">{subtitle}</p>
      <p className="text-[hsl(var(--color-ink))] text-sm leading-relaxed">{description}</p>
    </div>
  );
}
