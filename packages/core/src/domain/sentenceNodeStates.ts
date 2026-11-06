import { civShortCode } from "../config/civilizations";

type T = (key: string) => string;

/** The four civilizations' shared words, and what `nodeStateNamespace` falls back to. */
export const NODE_STATES = "sentence_plan.node_states";

/**
 * 受刑站所在去处的类型,按界面叫它的那个类型(v4 第八批 `realms.types_by_civ`、第十批第 3 条)。站上只有
 * `realm_code`,没有 `realm_type`,所以从种子表(backend/apps/actors/mythology/realms.py)抄过来;
 * `sentenceNodeStateByCivilization.test.ts` 读那份 Python 逐条核对。
 *
 * 两处与数据不同,是有意的:地狱前庭(EU_ANTINFERNO)数据里是 HELL,界面上是「前庭」(界域页的
 * `SHOWN_AS_NEUTRAL` 同一条理由);两真之殿(EG_HALL_TWO_TRUTHS)数据里是 PURGATORY,Design 把它放在
 * 埃及的 NEUTRAL(第八批 `realms.types_by_civ.eg.NEUTRAL`)。地府不在表里:第十批说地府整套沿用。
 */
export const REALM_SHOWN_TYPE: Readonly<Record<string, string>> = {
  EU_HEAVEN: "BLISS",
  EU_PURGATORY: "PURGATORY",
  EU_PURGATORY_T1_PRIDE: "PURGATORY",
  EU_PURGATORY_T2_ENVY: "PURGATORY",
  EU_PURGATORY_T3_WRATH: "PURGATORY",
  EU_PURGATORY_T4_SLOTH: "PURGATORY",
  EU_PURGATORY_T5_AVARICE: "PURGATORY",
  EU_PURGATORY_T6_GLUTTONY: "PURGATORY",
  EU_PURGATORY_T7_LUST: "PURGATORY",
  EU_EARTHLY_PARADISE: "PURGATORY",
  EU_HELL_1ST: "HELL",
  EU_HELL_2ND: "HELL",
  EU_HELL_3RD: "HELL",
  EU_HELL_4TH: "HELL",
  EU_HELL_5TH: "HELL",
  EU_HELL_6TH: "HELL",
  EU_HELL_7TH: "HELL",
  EU_HELL_8TH: "HELL",
  EU_HELL_9TH: "HELL",
  EU_ANTINFERNO: "NEUTRAL",
  EU_ACHERON: "NEUTRAL",
  EU_PLATO_MEADOW: "NEUTRAL",
  GR_ACHERON: "NEUTRAL",
  GR_ISLES_OF_THE_BLESSED: "BLISS",
  GR_TARTARUS: "HELL",
  EG_DUAT_ENTRY: "PURGATORY",
  EG_SEVEN_ARRWT: "PURGATORY",
  EG_HALL_TWO_TRUTHS: "NEUTRAL",
  EG_TWENTYONE_SEBKHET: "PURGATORY",
  EG_AARU: "BLISS",
  EG_ANNIHILATION: "ANNIHILATION",
};
/** Where the shown type differs from the seed's `realm_type`, and why is written above. */
export const REALM_SHOWN_TYPE_OVERRIDES: Readonly<Record<string, string>> = { EU_ANTINFERNO: "HELL", EG_HALL_TWO_TRUTHS: "PURGATORY" };

/**
 * 受刑站状态的显示词按「文明 × 去处类型」换(第十批第 3 条):有
 * `sentence_plan.node_states_by_civ.<文明>.<类型>.<状态>` 就用那个命名空间,没有(沿用、Design 标「不出现」、
 * 不认识的文明或去处)就回落四文明共用的 `sentence_plan.node_states`。给 `<DomainEnum namespace={…}>` 用,
 * 做法同 `realmTypeNamespace`(frontend/src/lib/domainNames.ts)。
 */
export function nodeStateNamespace(
  t: T,
  civilizationOrTenant: string | null | undefined,
  realmCode: string | null | undefined,
  status: string | null | undefined
): string {
  const civ = civShortCode(civilizationOrTenant);
  const type = realmCode ? REALM_SHOWN_TYPE[realmCode] : undefined;
  const ns = `sentence_plan.node_states_by_civ.${civ}.${type}`;
  return civ && type && status && t(`${ns}.${status}`) !== `${ns}.${status}` ? ns : NODE_STATES;
}
