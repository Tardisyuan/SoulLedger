import { civShortCode } from "../config/civilizations";

type T = (key: string) => string;

/** The four civilizations' shared words, and what `nodeStateNamespace` falls back to. */
export const NODE_STATES = "sentence_plan.node_states";

/**
 * 受刑站所在去处的类型,按界面叫它的那个类型(v4 第八批 `realms.types_by_civ`、第十批第 3 条)。站上只有
 * `realm_code`,没有 `realm_type`,所以从种子表(backend/apps/actors/mythology/realms.py)抄过来;
 * `sentenceNodeStateByCivilization.test.ts` 读那份 Python 逐条核对。
 *
 * 第九批起**与种子完全一致**:此前两处有意不同(地狱前庭读作 NEUTRAL「前庭」、两真之殿读作埃及的 NEUTRAL),
 * Design 按种子重定了叫法 —— 前庭是 HELL(读 `eu.HELL.*`,《地狱篇》第三歌),两真之殿是 PURGATORY(读
 * 「杜阿特」),两真之殿自己的状态词走按界域的覆盖(`node_states_by_realm`)。
 *
 * 地府的站也在表里(第十二批:灵魂端天界的「停留期」「我的居所」要知道这一站是 BLISS);站状态词地府整套沿用
 * (第十批),`node_states_by_civ.cn` 没有任何一项,所以 `nodeStateNamespace` 在地府照旧回落共用词。
 */
export const REALM_SHOWN_TYPE: Readonly<Record<string, string>> = {
  DY_01_HEAVEN: "BLISS",
  DY_02_YANGLIU: "BLISS",
  DY_00_PURGATORY: "PURGATORY",
  DY_COURT_01_QINGUANG: "HELL",
  DY_COURT_02_CHUJIANG: "HELL",
  DY_COURT_03_SONGDI: "HELL",
  DY_COURT_04_WUGUAN: "HELL",
  DY_COURT_05_YANLUO: "HELL",
  DY_COURT_06_BIANCHENG: "HELL",
  DY_COURT_07_TAISHAN: "HELL",
  DY_COURT_08_DUSHI: "HELL",
  DY_COURT_09_PINGDENG: "HELL",
  DY_COURT_10_ZHUANLUN: "HELL",
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
  EU_ANTINFERNO: "HELL",
  EU_ACHERON: "NEUTRAL",
  GR_PLATO_MEADOW: "NEUTRAL",
  GR_ACHERON: "NEUTRAL",
  GR_ISLES_OF_THE_BLESSED: "BLISS",
  GR_TARTARUS: "HELL",
  EG_DUAT_ENTRY: "PURGATORY",
  EG_SEVEN_ARRWT: "PURGATORY",
  EG_HALL_TWO_TRUTHS: "PURGATORY",
  EG_TWENTYONE_SEBKHET: "PURGATORY",
  EG_AARU: "BLISS",
  EG_ANNIHILATION: "ANNIHILATION",
};
/** Where the shown type differs from the seed's `realm_type`. Empty since batch 9; kept so the seed check reads the same. */
export const REALM_SHOWN_TYPE_OVERRIDES: Readonly<Record<string, string>> = {};

/**
 * 一个界域码所在的文明短码与去处类型(给 `civKey` 的 `civilizationOrTenant` / `place`):码的前缀就是文明
 * (`DY_` 是地府 `cn`)。表里没有的码类型是 undefined。
 */
export function realmPlace(realmCode: string | null | undefined): { civ: string | undefined; type: string | undefined } {
  if (!realmCode) return { civ: undefined, type: undefined };
  const prefix = realmCode.split("_")[0];
  return { civ: prefix === "DY" ? "cn" : civShortCode(prefix), type: REALM_SHOWN_TYPE[realmCode] };
}

/**
 * 希腊的案子按所选文书(`greek_account`)分两套词(第十二批 GR 9):判在《理想国》的,先查伪文明
 * `gr_republic`(义人「天上千年」,不义者「地下千年」),查不到再回落 `gr`。别的文明、别的文书只有自己。
 */
function civsOf(civilizationOrTenant: string | null | undefined, greekAccount?: string | null): string[] {
  const civ = civShortCode(civilizationOrTenant);
  if (!civ) return [];
  return civ === "gr" && greekAccount === "REPUBLIC" ? ["gr_republic", "gr"] : [civ];
}

/**
 * 受刑站状态的显示词(第十批第 3 条、第九批第 3 条)。查找次序:
 * `sentence_plan.node_states_by_realm.<界域码>.<状态>` → `node_states_by_civ.<文明>.<类型>.<状态>` →
 * 四文明共用的 `sentence_plan.node_states`。给 `<DomainEnum namespace={…}>` 用,做法同 `realmTypeNamespace`
 * (frontend/src/lib/domainNames.ts)。
 */
export function nodeStateNamespace(
  t: T,
  civilizationOrTenant: string | null | undefined,
  realmCode: string | null | undefined,
  status: string | null | undefined,
  greekAccount?: string | null
): string {
  const has = (ns: string) => !!status && t(`${ns}.${status}`) !== `${ns}.${status}`;
  const civs = civsOf(civilizationOrTenant, greekAccount);
  if (!civs.length || !realmCode) return NODE_STATES;
  const byRealm = `sentence_plan.node_states_by_realm.${realmCode}`;
  if (has(byRealm)) return byRealm;
  const type = REALM_SHOWN_TYPE[realmCode];
  for (const civ of type ? civs : []) {
    const ns = `sentence_plan.node_states_by_civ.${civ}.${type}`;
    if (has(ns)) return ns;
  }
  return NODE_STATES;
}

/**
 * 「受刑」一族的词按文明换(Design v4 第十二批第 1 条),返回交给 `t()` 的键:
 *
 *   - **计划一层**(页面名、菜单、事件名、官员通知……)不给 `place`:`<键>_by_civ.<文明>` → `<键>`。
 *     底键是中性的「去处计划」,地府在 `_by_civ.cn` 里保留「受刑计划」。
 *   - **灵魂自己那一层**给去处类型 `place`(`HELL` / `PURGATORY` / `BLISS` …):
 *     `<键>_by_civ.<文明>.<类型>` → `<键>`。受罚的就是底键(受刑、刑期)。
 *   - 希腊按《理想国》判的(`greekAccount === "REPUBLIC"`)先查 `gr_republic`,再查 `gr`。
 *
 * 拿不到文明、或那一项 Design 没给,一律是底键。
 */
export function civKey(
  t: T,
  key: string,
  civilizationOrTenant: string | null | undefined,
  place?: string | null,
  greekAccount?: string | null
): string {
  for (const civ of civsOf(civilizationOrTenant, greekAccount)) {
    const k = place ? `${key}_by_civ.${civ}.${place}` : `${key}_by_civ.${civ}`;
    if (t(k) !== k) return k;
  }
  return key;
}
