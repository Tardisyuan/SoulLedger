"use client";

import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { hasRebirth } from "@/src/lib/hasRebirth";
import s from "./dossier.module.css";

export type DossierTabKey = "dossier" | "merits" | "events" | "lives" | "sentence";
export const DOSSIER_TABS: readonly DossierTabKey[] = ["dossier", "merits", "events", "lives", "sentence"];

/**
 * 卷宗头下的一行页签(Design 第三十批 第 3 步第 1 条):原灵魂详情的分页 —— 卷宗 · 功过 · 事件 · 轮回 · 受刑,
 * 计数用 mono;没有数(没取、或没权限)写「–」,不写 0。页签是链接:同一份卷宗的各节(`href` 由页面给)。
 */
export function DossierTabs({
  current,
  hrefs,
  counts = {},
  civilization,
}: {
  current: DossierTabKey;
  hrefs: Record<DossierTabKey, string>;
  counts?: Partial<Record<DossierTabKey, number | null>>;
  /** Europe and Egypt have no wheel: no 轮回 tab (`hasRebirth`; demo civilizations.spec 「has no wheel」). */
  civilization?: string | null;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("caseDesk.dossier.tabs.label")} className={s.tabs} data-testid="dossier-tabs">
      {DOSSIER_TABS.filter((key) => key !== "lives" || hasRebirth(civilization)).map((key) => (
        <Link key={key} href={hrefs[key]} className={s.tab} aria-current={key === current ? "page" : undefined} data-tab={key}>
          {t(`caseDesk.dossier.tabs.${key}`)}
          {key !== "dossier" && <span className={s.tabCount}>{counts[key] ?? "–"}</span>}
        </Link>
      ))}
    </nav>
  );
}
