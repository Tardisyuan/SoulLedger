"use client";

import type { ReactNode } from "react";
import {
  DESIGN_CREDITS,
  FONT_CREDITS,
  IMAGE_CREDITS,
  LICENCE_LABELS,
  LITERATURE_CIVILIZATIONS,
  LITERATURE_CREDITS,
  ORNAMENT_CREDITS,
  OSS_CREDITS,
  OSS_GROUPS,
  SERVICE_CREDITS,
  type Credit,
} from "@soulledger/core/config/credits";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { SectionTitle } from "@/src/components/plaque/SectionTitle";

/**
 * 关于 / 致谢(规范 v2 补足 C16):入口在用户菜单。数据在 packages/core 的
 * `config/credits.ts`,App 的同名页读同一份;专名不进语言包,只有分节标题翻译。
 * 链接静息态就带下划线(见 proseLinkIsNotColourOnly)。
 * 开源软件一节有八十多行,按平台分成四个默认收起的 <details>,不把页面撑长。
 */
const LINK = "underline underline-offset-2 text-[oklch(var(--color-ink))]";
const MUTED = "text-[oklch(var(--color-ink-muted))]";

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

/** 一行:左边专名与补充,右边等宽的注记(授权、默认)。 */
function Row({ name, detail, url, aside }: { name: ReactNode; detail?: string; url?: string; aside?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-[oklch(var(--color-rule))] py-2">
      <span className="min-w-0">
        <span className="block">{name}</span>
        {detail || url ? (
          <span className={`block text-xs ${MUTED}`}>
            {detail}
            {detail && url ? " · " : null}
            {url ? <ExtLink href={url}>{t("about.source")}</ExtLink> : null}
          </span>
        ) : null}
      </span>
      <span className={`max-w-48 break-words text-right font-mono text-xs ${MUTED}`}>{aside}</span>
    </li>
  );
}

function Rows({ credits }: { credits: Credit[] }) {
  const { t } = useI18n();
  return (
    <ul className="text-sm">
      {credits.map((c) => {
        const licence = c.licence === "PD" ? null : LICENCE_LABELS[c.licence];
        return (
          <Row
            key={`${c.name} · ${c.detail ?? ""}`}
            name={c.name}
            detail={c.detail}
            url={c.url}
            aside={licence ? <ExtLink href={licence.url}>{licence.label}</ExtLink> : t("about.public_domain")}
          />
        );
      })}
    </ul>
  );
}

function Section({ stem, title, aside, children }: { stem: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="pt-6">
        <SectionTitle aside={aside}>
          <span aria-hidden="true">{stem} · </span>
          {title}
        </SectionTitle>
      </div>
      {children}
    </section>
  );
}

function OpenSource() {
  const { t } = useI18n();
  return (
    <>
      {OSS_GROUPS.map((group) => (
        <details key={group} className="border-b border-[oklch(var(--color-rule))]">
          <summary className="cursor-pointer py-2 text-sm">
            {t(`about.group_${group}`)}
            <span className={`ml-2 font-mono text-2xs ${MUTED}`}>{OSS_CREDITS[group].length}</span>
          </summary>
          <ul className="pb-2 text-sm">
            {OSS_CREDITS[group].map((c) => (
              <Row key={c.name} name={<ExtLink href={c.url}>{c.name}</ExtLink>} aside={c.licence ?? t("about.undeclared")} />
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}

function Literature() {
  const { t } = useI18n();
  return (
    <>
      {LITERATURE_CIVILIZATIONS.map((civ) => (
        <div key={civ}>
          <h3 className={`pt-3 text-2xs uppercase ${MUTED}`}>{t(`home.civ_subtitle.${civ}`)}</h3>
          <ul className="text-sm">
            {LITERATURE_CREDITS.filter((c) => c.civilization === civ).map((c) => (
              <Row key={c.title} name={c.title} detail={c.details.join(" · ")} url={c.url} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export default function AboutPage() {
  const { t } = useI18n();
  return (
    <PageShell title={t("about.title")} subtitle={t("about.intro")} variant="prose">
      <Section stem="甲" title={t("about.fonts")}>
        <Rows credits={FONT_CREDITS} />
      </Section>
      <Section stem="乙" title={t("about.ornament")}>
        <Rows credits={ORNAMENT_CREDITS} />
      </Section>
      <Section stem="丙" title={t("about.images")}>
        <Rows credits={IMAGE_CREDITS} />
      </Section>
      <Section stem="丁" title={t("about.software")}>
        <OpenSource />
      </Section>
      <Section stem="戊" title={t("about.literature")}>
        <Literature />
      </Section>
      <Section stem="己" title={t("about.services")} aside={t("about.by_deployment")}>
        <ul className="text-sm">
          {SERVICE_CREDITS.map((s) => (
            <Row key={s.name} name={s.name} detail={s.detail} url={s.url} aside={s.isDefault ? t("about.default") : null} />
          ))}
        </ul>
      </Section>
      <Section stem="庚" title={t("about.design")}>
        <ul className="text-sm">
          {DESIGN_CREDITS.map((d) => (
            <Row key={d.name} name={d.name} detail={d.detail} />
          ))}
        </ul>
      </Section>
    </PageShell>
  );
}
