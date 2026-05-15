"use client";

import { useI18n } from "@/src/contexts/I18nContext";

export default function HomePage() {
  const { t, locale } = useI18n();

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="container mx-auto px-4 py-16">
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

        <div className="mt-16 text-center">
          <p className="text-[hsl(var(--color-ink-subtle))] text-sm">
            {t("footer.built_with")}
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
      </div>
    </main>
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
