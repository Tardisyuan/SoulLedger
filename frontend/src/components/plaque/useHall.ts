"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { civSkinOf } from "@/src/lib/civSkin";

/**
 * 身份带的殿名「<冥界名> · <司 / 殿>」:每页写一个固定的司名(`plaque.office.*`),
 * 审判类页面写当前案子的殿(`judgment.court`、节点的 `court_code`)。
 * 前缀是文明的冥界名(`plaque.realm.<civ>`:酆都 / 彼岸 / 杜阿特 / 哈迪斯,用户 2026-10-02),
 * 不是租户展示名;认不出文明(neutral)才退回租户展示名。
 * `place` 为空(案子没记殿、还没加载)→ undefined,身份带退回只写租户名。
 * 交给 `usePlaque({ hall })`。
 */
export function useHall(place: string | null | undefined): string | undefined {
  const tenant = useTenant().user?.tenant;
  const { t } = useI18n();
  if (!place) return undefined;
  const civ = civSkinOf(tenant?.code ?? null);
  const realm = civ === "neutral" ? tenant?.display_name : t(`plaque.realm.${civ}`);
  return realm ? `${realm} · ${place}` : place;
}

/**
 * 「第十殿」那一格按文明换(用户 2026-10-02):地府 第十殿 · 欧洲 米诺斯之庭 · 埃及 双真理厅 ·
 * 希腊 三判官之庭。认不出文明时写第十殿(改动前的样子)。其余三个司四文明共用。
 */
export function useCourtOffice(): string {
  const civ = civSkinOf(useTenant().user?.tenant?.code ?? null);
  const { t } = useI18n();
  return t(`plaque.office.court.${civ === "neutral" ? "cn" : civ}`);
}
