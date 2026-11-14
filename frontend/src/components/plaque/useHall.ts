"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useImpersonation } from "@/src/components/impersonation/useImpersonation";
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
  const realm = useRealm();
  if (!place) return undefined;
  return realm ? `${realm} · ${place}` : place;
}

/**
 * 文明的冥界名(`plaque.realm.<civ>`),认不出文明才退回租户展示名。身份带不写司名时
 * 也用它:租户展示名是库里的英文(「Chinese Afterlife」),中文界面下直接露出来(2026-10-03)。
 */
export function useRealm(): string | undefined {
  const tenant = useTenant().user?.tenant;
  const { t } = useI18n();
  const civ = civSkinOf(useHallCode());
  return civ === "neutral" ? tenant?.display_name : t(`plaque.realm.${civ}`);
}

/**
 * 「第十殿」那一格按文明换(用户 2026-10-02):地府 第十殿 · 欧洲 米诺斯之庭 · 埃及 双真理厅 ·
 * 希腊 三判官之庭。认不出文明时写第十殿(改动前的样子)。其余三个司四文明共用。
 * 进殿查看时读所进的殿;未绑殿、也没进殿的全局管理员不在任何一殿,返回 undefined(身份带不写殿名)。
 */
export function useCourtOffice(): string | undefined {
  const code = useHallCode();
  const { t } = useI18n();
  if (!code) return undefined;
  const civ = civSkinOf(code);
  return t(`plaque.office.court.${civ === "neutral" ? "cn" : civ}`);
}

/**
 * 此刻所在的殿的文明短码(`cn` / `eu` / `eg` / `gr`),认不出是 undefined。申诉只在本殿审,
 * 所以申诉页拿它给 `verdictNamespace`(欧洲的 PURGATORY 叫「炼狱」,不叫「存疑」)。
 */
export function useHallCivilization(): string | undefined {
  const civ = civSkinOf(useHallCode());
  return civ === "neutral" ? undefined : civ;
}

/** 此刻所在的殿:进殿查看时是所进的殿,否则是账号绑的殿;都没有是 null。 */
function useHallCode(): string | null {
  const viewed = useImpersonation()?.hallView?.code;
  const own = useTenant().user?.tenant?.code;
  return viewed ?? own ?? null;
}

/**
 * 此刻所在的殿的殿名,按界面语言(页头的地府记号,第四十五批;用户 2026-11-14 定「殿名随殿变」)。
 * 来源:代看 / 进殿查看时是 `target.hall`,否则是账号所在殿的 `hall_names`(都来自 `Tenant.hall_names`)。
 * egy 没填时后端退回 zh,这里改退英文(用户定:egy 界面不露汉字殿名)。都没有(旧的缓存信封)是 undefined。
 */
export function useHallName(): string | undefined {
  const { locale } = useI18n();
  const viewed = useImpersonation()?.target?.hall;
  const own = useTenant().user?.tenant?.hall_names;
  const names = viewed ?? own;
  if (!names) return undefined;
  const zh = names["zh-Hans"];
  if (locale === "zh-Hans") return zh || undefined;
  if (locale === "egy" && names.egy && names.egy !== zh) return names.egy;
  return names.en || undefined;
}
