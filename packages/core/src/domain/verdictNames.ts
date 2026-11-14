import { CIVILIZATION_SHORT_CODES } from "../config/civilizations";

type T = (key: string) => string;

/**
 * 裁决的显示词按文明(Design v4 第十一批 1a,用户 2026-11-06 定全站跟进):`PURGATORY` 通用名「存疑」,
 * 欧洲叫「炼狱」、埃及叫「天平摇摆」(`judgment.verdicts_by_civ.<文明短码>.<裁决小写>`)。没有那一项
 * (地府、希腊、别的三个裁决、拿不到文明)就回落到通用的 `judgment.verdicts`。
 *
 * 与 web 的 `realmTypeNamespace` 同一个做法:只选命名空间,给 `<DomainEnum namespace={…}>` / `enumLabel(ns, …)` 用,
 * 原始枚举值照旧由它们放进 title。放在 core 里是因为两个 App 也要用。
 */
export function verdictNamespace(t: T, civilization: string | null | undefined, verdict: string | null | undefined): string {
  // 认 `EUROPEAN` 这样的全名,也认 App 皮肤用的短码(`eu`)。
  const civ = civilization
    ? (CIVILIZATION_SHORT_CODES[civilization] ?? (Object.values(CIVILIZATION_SHORT_CODES).includes(civilization) ? civilization : undefined))
    : undefined;
  const ns = `judgment.verdicts_by_civ.${civ}`;
  const key = `${ns}.${(verdict ?? "").toLowerCase()}`;
  return civ && verdict && t(key) !== key ? ns : "judgment.verdicts";
}

/**
 * 句子里要的那一个词(`t()` 的参数、选项文字)。有文明的叫法就用它,否则用 `fallbackKey`
 * (默认 `judgment.verdicts.<小写>`;灵魂时间线用的是 `souls.detail.verdict_<小写>`)。
 */
export function verdictText(
  t: T,
  civilization: string | null | undefined,
  verdict: string,
  fallbackKey = `judgment.verdicts.${verdict.toLowerCase()}`,
): string {
  const ns = verdictNamespace(t, civilization, verdict);
  return ns === "judgment.verdicts" ? t(fallbackKey) : t(`${ns}.${verdict.toLowerCase()}`);
}

/**
 * 落印之后是「进入审批」还是「即定」(用户 2026-11-14):原审一律走审批流程,处置等流程走完才执行,驳回则撤回处置、重开一案
 * (backend `apps/judgment/services.py` 的 `conclude`「原审一律走审批流程」那段),所以说它「不可撤回」说过头了。
 * 即定的是再审裁决 —— RETRY 在哪都是,PURGATORY 在地府(待审所)和埃及(天平摇摆)也是(`apps.realms.cosmology._outcome`):
 * 结案另开一案、直接返回,不建流程。非原审(重开、加减项)只有调用方要了流程才有,`withWorkflow` 就是这一问。
 * 早夭与枉死城超度不在审判台上落印,不在这里判。
 */
export function sealGoesToApproval(withWorkflow: boolean, civilization: string | null | undefined, verdict: string | null | undefined): boolean {
  if (!withWorkflow) return false;
  const civ = civilization ? (CIVILIZATION_SHORT_CODES[civilization] ?? civilization) : "";
  return !(verdict === "RETRY" || (verdict === "PURGATORY" && (civ === "cn" || civ === "eg")));
}
