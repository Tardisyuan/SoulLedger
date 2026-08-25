"use client";

import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { ExternalLink } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTheme } from "@/src/contexts/ThemeContext";

/**
 * 落地页。**这一页不套 PageShell,而且它的 `min-h-screen` 是合法的。**
 *
 * 证据不是判断,是路由:`src/components/layout/AppLayoutWrapper.tsx` 里
 * `PUBLIC_PATHS = ["/"]`,命中时它 `return <>{children}</>` —— 直接把 children
 * 交出去,不经 AppLayout。也就是说这一页和 `app/(auth)/login/page.tsx` 处境
 * 相同:没有那条 `h-16` 的头,没有面包屑,也没有 AppLayout 那个
 * `min-h-[calc(100vh-4rem)]` 的槽位。PageShell 的三条前提在这里全部不成立 ——
 * 它不画面包屑是因为 AppLayout 画了;它的筛选栏钉 `top-16` 是因为要贴在
 * AppLayout 的头下沿;它不写 `min-h-screen` 是因为槽位已经给了高度。这一页
 * 三样都没有,所以高度得自己给。
 *
 * 第二个理由是内容性质:PageShell 是**卷宗外壳** —— eyebrow(卷宗编号)、
 * backLink(离开这一页)、tabs、筛选、分页。落地页一个槽都用不上,唯一能用的
 * `title` 会把首屏大标题渲染成一条 32px、压在发丝线上的卷宗抬头,恰好是
 * 首屏标题的反面。
 *
 * 它仍然走同一套字级表、圆角表与间距节奏 —— 不套外壳不等于不进设计系统。
 */
export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useTenant();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header with logo */}
      <header className="h-16 border-b border-[hsl(var(--color-hairline))] flex items-center px-6">
        <div className="flex items-center gap-2">
          <svg className="w-7 h-7 text-[hsl(var(--color-accent-ink))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5M5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
          </svg>
          <span className="text-[hsl(var(--color-accent-ink))] font-bold">SoulLedger</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />

          <Divider />

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === "dark" ? t("nav.theme_light") : t("nav.theme_dark")}
            className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent-ink))] transition-colors p-1"
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

          <Divider />

          {/* 迁移前这里是两个 <a>,className 逐字相同,只有 href 不同 —— 一处
              98 个字符的类名串抄了两遍。分支只影响 href,所以只留 href 分支。
              形状对齐 src/components/ui/Button.tsx 的 primary 配方(accent 底 +
              text-black,9.82:1;那份算术在该文件里)。这里仍是 <a> 而不是
              <Button>:它导航,不触发动作。 */}
          <a
            href={user ? "/dashboard" : "/login"}
            className="inline-flex items-center gap-2 px-3 py-2 text-03 font-medium bg-accent text-black border border-accent hover:bg-accent-hover hover:border-accent-hover transition-colors"
          >
            {t("home.console")}
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-10 md:py-16">
        <header className="text-center mb-10 md:mb-16">
          {/* 八档字级表最上面那两档。迁移前是 `text-4xl md:text-5xl lg:text-6xl`
              —— 三个断点、三个表外字号。 */}
          <h1 className="text-07 md:text-08 mb-4 text-[hsl(var(--color-accent-ink))]">
            {t("home.hero_title")}
          </h1>
          <p className="text-[hsl(var(--color-accent-ink))]/80 text-05 mb-2">{t("home.hero_subtitle")}</p>
          <p className="text-[hsl(var(--color-ink-subtle))] text-04 max-w-prose mx-auto">
            {t("home.hero_description")}
          </p>
        </header>

        <section>
          <h2 className="text-06 text-center mb-6 md:mb-10 text-[hsl(var(--color-ink-muted))]">
            {t("home.civilizations_title")}
          </h2>
          <div className="grid md:grid-cols-3 gap-4 md:gap-6 max-w-4xl mx-auto">
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
        <div className="mt-10 md:mt-16 text-center">
          {locale === "zh-Hans" && (
            <p className="text-[hsl(var(--color-ink-subtle))] text-03">
              万古轮回皆有录
            </p>
          )}
          {locale === "en" && (
            <p className="text-[hsl(var(--color-ink-subtle))] text-03 italic">
              Every soul weighed, every life recorded
            </p>
          )}
          {locale === "egy" && (
            <p
              className="text-[hsl(var(--color-accent-ink))] text-02"
              style={{ fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }}
            >
              𓇳 𓋹 𓎛 𓃭
            </p>
          )}
          <p className="text-[hsl(var(--color-ink-subtle))] text-03 mt-1">
            {t("footer.version")}
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * 头部那两条竖分隔线。
 *
 * 迁移前它们是 `<div className="w-px h-5 border-[hsl(var(--color-hairline))]" />`
 * —— **画不出任何东西**:`border-<颜色>` 只设颜色不设宽度,Tailwind 的
 * `border` 宽度类没写,元素也没有背景,所以那是两个 1px 宽、20px 高的透明块。
 * 分隔线要的是**填充**,不是边框。
 */
function Divider() {
  return <div aria-hidden="true" className="w-px h-5 bg-[hsl(var(--color-hairline))]" />;
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
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 md:p-6 h-full flex flex-col">
      <p
        className="text-06 mb-1"
        style={
          isEgyptian
            ? { fontFamily: "'Noto Sans Egyptian Hieroglyphs', sans-serif" }
            : undefined
        }
      >
        {title}
      </p>
      <p className="text-02 text-[hsl(var(--color-ink-muted))] mb-3 md:mb-4">{subtitle}</p>
      <p className="text-[hsl(var(--color-ink))] text-03 leading-relaxed">{description}</p>
    </div>
  );
}
