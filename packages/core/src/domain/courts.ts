/**
 * 殿名(节点的 `court_code`、审判的 `court`)按界面语言显示(2026-10-19 用户决定):中文界面写中文,英文界面写英文,
 * 埃及文界面写英文(用户说埃及文不必考虑)。
 *
 * 库里存的是自由文本,中英混写:内置模板写 Heaven / Diocese / Hall of Two Truths,前端预设写 天堂 / 两真之殿,
 * 十殿写 第一殿 … 同一个殿的每一种写法都对到一个键 `workflow.court.<slug>`;认不出的原样显示。
 * 写法来自 `backend/apps/workflow/templates.py` 的 `WORKFLOW_TEMPLATES`、`config/workflow-templates.ts` 的预设、
 * `seed_workflow_templates`。不改库里的数据:旧写法靠这张表认。
 * 模板之外由代码写进库的:转生申请的节点(`soul_accounts/rebirth.py`)、重开审判的 `court`
 * (`sentence_plan/requests.py`);没有模板时的单节点兜底流程把文明代码(`CHINESE` …)当殿名写
 * (`WorkflowService._generic_template`),那个按 `souls.civilizations` 显示。
 *
 * 埃及文:语言包里缺的键退回 zh-Hans(`t()` 的规则),不是 en —— 所以这些键列在 `egyPendingKeys.json`,
 * 而 egy 由这里直接给英文(`EN`,与 en.json 同值,`courtLabel.test.ts` 对着两边核)。
 */

import { isCivilizationOption } from "../config/civilizations";

/** slug → 英文名(egy 用)与库里出现过的写法。 */
const COURTS: Record<string, { en: string; spellings: readonly string[] }> = {
  heaven: { en: "Heaven", spellings: ["天堂", "Heaven"] },
  heaven_gate: { en: "Gate of Heaven", spellings: ["天堂之门", "Heaven Gate", "Gate of Heaven"] },
  diocese: { en: "Diocese", spellings: ["主教座堂", "Diocese"] },
  archdiocese: { en: "Archdiocese", spellings: ["教省", "Archdiocese"] },
  vatican: { en: "Vatican", spellings: ["罗马教廷", "Vatican"] },
  confessional: { en: "Confessional", spellings: ["告解室", "Confessional"] },
  purgatory: { en: "Purgatory", spellings: ["炼狱", "Purgatory", "Purgatory Court"] },
  two_truths: { en: "Hall of Two Truths", spellings: ["两真之殿", "Hall of Two Truths"] },
  duat: { en: "Duat", spellings: ["杜阿特", "Duat"] },
  egypt: { en: "Egypt", spellings: ["埃及", "Egypt"] },
  crossroads: { en: "Meadow at the Crossroads", spellings: ["岔路口草地", "Meadow at the Crossroads"] },
  second_circle_gate: { en: "Entrance to the Second Circle", spellings: ["第二层入口", "Entrance to the Second Circle"] },
  ninth_circle: { en: "Ninth Circle", spellings: ["第九层", "Ninth Circle"] },
  court_1: { en: "First Court", spellings: ["第一殿", "First Court"] },
  court_2: { en: "Second Court", spellings: ["第二殿", "Second Court"] },
  court_3: { en: "Third Court", spellings: ["第三殿", "Third Court"] },
  court_4: { en: "Fourth Court", spellings: ["第四殿", "Fourth Court"] },
  court_5: { en: "Fifth Court", spellings: ["第五殿", "Fifth Court"] },
  court_6: { en: "Sixth Court", spellings: ["第六殿", "Sixth Court"] },
  court_7: { en: "Seventh Court", spellings: ["第七殿", "Seventh Court"] },
  court_8: { en: "Eighth Court", spellings: ["第八殿", "Eighth Court"] },
  court_9: { en: "Ninth Court", spellings: ["第九殿", "Ninth Court"] },
  court_10: { en: "Tenth Court", spellings: ["第十殿", "Tenth Court"] },
  ten_courts: { en: "Ten Courts", spellings: ["十殿", "Ten Courts"] },
  inspection: { en: "Inspection Bureau", spellings: ["察查司", "Inspection Bureau"] },
  original_court: { en: "Original Court", spellings: ["原审判殿", "Original Court"] },
  court_above: { en: "Court Above", spellings: ["上一殿", "Court Above"] },
  fengdu: { en: "Fengdu", spellings: ["酆都", "Fengdu"] },
  city_god: { en: "City God", spellings: ["城隍", "City God"] },
  city_god_system: { en: "City God system", spellings: ["城隍体系", "City God system"] },
  wrongful_death_city: { en: "City of Wrongful Death", spellings: ["枉死城", "City of Wrongful Death"] },
  jiuhua: { en: "Mount Jiuhua", spellings: ["九华山", "Mount Jiuhua"] },
  avici: { en: "Avici Hell", spellings: ["阿鼻地狱", "Avici Hell"] },
  rebirth_application: { en: "Rebirth application", spellings: ["转生申请", "Rebirth application"] },
  reopened_judgment: { en: "Reopened judgment", spellings: ["重开审判", "Reopened judgment"] },
};

const norm = (s: string) => s.trim().toLowerCase();

const BY_SPELLING = new Map<string, string>(
  Object.entries(COURTS).flatMap(([slug, c]) => c.spellings.map((s) => [norm(s), slug] as const)),
);

/** 一个写法对到的 slug;认不出时 null。 */
export const courtSlug = (court: string | null | undefined): string | null => (court ? BY_SPELLING.get(norm(court)) ?? null : null);

/** 测试用:每个 slug 与它给 egy 的英文名。 */
export const COURT_EN: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(COURTS).map(([slug, c]) => [slug, c.en]));

/** 殿名按界面语言:认得的翻译,认不出的原样,空的给 ""。`locale` 是 egy 时给英文。 */
export function courtLabel(
  t: (key: string, vars?: Record<string, string>) => string,
  court: string | null | undefined,
  locale?: string,
): string {
  const slug = courtSlug(court);
  if (!slug) return isCivilizationOption(court) ? t(`souls.civilizations.${court}`) : court ?? "";
  if (locale === "egy") return COURTS[slug].en;
  // A bundle without the key (or a test double that echoes keys) shows the stored text, never the key.
  const key = `workflow.court.${slug}`;
  const label = t(key);
  return label && label !== key ? label : court ?? "";
}
