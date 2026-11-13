import type { DossierTabKey } from "./DossierTabs";

/**
 * 页签指向哪里。卷宗(`dossierHref`)是这一页本身 —— 审判中的案子是 `/judgment/{id}`,没有在判的灵魂是
 * `/souls/{id}`;另外四节在灵魂那一页上的锚点(`app/souls/[id]/page.tsx` 的同名 id)。
 */
export function dossierTabHrefs(soulId: string, dossierHref: string): Record<DossierTabKey, string> {
  const soul = `/souls/${encodeURIComponent(soulId)}`;
  return {
    dossier: dossierHref,
    merits: `${soul}#dossier-merits`,
    events: `${soul}#dossier-events`,
    // 轮回记录与事件在同一条时间线里(`SoulTimelineColumn`)。
    lives: `${soul}#dossier-events`,
    sentence: `${soul}#dossier-sentence`,
  };
}
