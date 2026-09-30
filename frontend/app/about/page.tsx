"use client";

import { FONT_CREDITS, IMAGE_CREDITS, LICENCE_LABELS, ORNAMENT_CREDITS, type Credit } from "@soulledger/core/config/credits";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { LedgerHeading } from "@/src/components/souls/detail/SoulLedgerSections";

/**
 * 关于 / 致谢(规范 v2 补足 C16):入口在用户菜单。数据在 packages/core 的
 * `config/credits.ts`,App 的同名页读同一份;专名不进语言包,只有分节标题翻译。
 * 链接静息态就带下划线(见 proseLinkIsNotColourOnly)。
 */
const LINK = "underline underline-offset-2 text-[oklch(var(--color-ink))]";

function Rows({ credits }: { credits: Credit[] }) {
  const { t } = useI18n();
  return (
    <ul className="text-sm">
      {credits.map((c) => {
        const licence = c.licence === "PD" ? null : LICENCE_LABELS[c.licence];
        return (
          <li
            key={`${c.name} · ${c.detail ?? ""}`}
            className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-[oklch(var(--color-rule))] py-2"
          >
            <span className="min-w-0">
              <span className="block">{c.name}</span>
              {c.detail || c.url ? (
                <span className="block text-xs text-[oklch(var(--color-ink-muted))]">
                  {c.detail}
                  {c.detail && c.url ? " · " : null}
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                      {t("about.source")}
                    </a>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className="text-right font-mono text-xs text-[oklch(var(--color-ink-muted))]">
              {licence ? (
                <a href={licence.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {licence.label}
                </a>
              ) : (
                t("about.public_domain")
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function AboutPage() {
  const { t } = useI18n();
  return (
    <PageShell title={t("about.title")} subtitle={t("about.intro")} variant="prose">
      <section>
        <LedgerHeading mark="甲" title={t("about.fonts")} />
        <Rows credits={FONT_CREDITS} />
      </section>
      <section>
        <LedgerHeading mark="乙" title={t("about.ornament")} />
        <Rows credits={ORNAMENT_CREDITS} />
      </section>
      <section>
        <LedgerHeading mark="丙" title={t("about.images")} />
        <Rows credits={IMAGE_CREDITS} />
      </section>
    </PageShell>
  );
}
