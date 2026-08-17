// Civilization and tenant code mappings
//
// These four maps are the frontend's copy of `TENANT_CIVILIZATION` /
// `CIVILIZATION_TENANT` in backend/apps/souls/models.py. GREEK is the fourth
// member: `Civilization.GREEK`, tenant `GR_HADES`, holding Plato's fork
// (EU_PLATO_MEADOW, whose code still records where it was written), the Isles
// of the Blessed and Tartarus, with Hades, Aeacus, Rhadamanthus and Plato's
// Minos standing on the fork.
//
// A civilization missing from these maps does not fail loudly. Every one of
// them is typed `Record<string, string>`, so the lookup returns `undefined` and
// the UI renders a blank badge, a raw tenant code, or an untranslated key — the
// silent-wrong-value shape this repository keeps finding. Adding a fifth
// civilization means adding it here, in the five `civilizations` blocks of each
// of the three files under `messages/`, and in the per-page icon/colour maps
// that spell the members out (app/actors, app/organizations, app/realms,
// app/judgment/[id]).

/**
 * 本前端认得的文明，**一处列全**，供下拉框渲染与「这个字符串是不是文明」的守卫
 * 共用。
 *
 * 它原本不存在：`WorkflowEditor` 与 `Modal` 各自写了一份字面量联合、两条
 * `civ === "A" || civ === "B" || civ === "C"` 的或链，以及三个手写 `<option>`。
 * 加第四个文明时漏掉任何一处都不会报错——两条或链只在认得的值上 setState，认不得
 * 就把状态留在默认的 `"CHINESE"`，于是打开 `GREEK_ROUTINE` 预设会静默地当成中国
 * 十殿存回去。列表化之后联合类型由列表推出，守卫与 `<option>` 都读同一份。
 *
 * 顺序即下拉框顺序。与后端 `apps/souls/models.py::Civilization` 的成员一一对应。
 */
export const CIVILIZATION_OPTIONS = [
  "CHINESE",
  "EUROPEAN",
  "EGYPTIAN",
  "GREEK",
] as const;

export type CivilizationOption = (typeof CIVILIZATION_OPTIONS)[number];

export function isCivilizationOption(value: unknown): value is CivilizationOption {
  return CIVILIZATION_OPTIONS.includes(value as CivilizationOption);
}

export const CIVILIZATION_CODES = {
  CHINESE: "CN_DIYU",
  EUROPEAN: "EU_HEAVEN_HELL",
  EGYPTIAN: "EG_DUAT",
  GREEK: "GR_HADES",
} as const;

export const TENANT_CODE_TO_CIVILIZATION: Record<string, string> = {
  CN_DIYU: "CHINESE",
  EU_HEAVEN_HELL: "EUROPEAN",
  EG_DUAT: "EGYPTIAN",
  GR_HADES: "GREEK",
};

export const CIVILIZATION_LABELS: Record<string, string> = {
  CHINESE: "中国地府",
  EUROPEAN: "欧洲天堂地狱",
  EGYPTIAN: "埃及冥界",
  GREEK: "希腊冥界",
};

export const CIVILIZATION_DISPLAY_NAMES: Record<string, string> = {
  CN_DIYU: "Chinese",
  EU_HEAVEN_HELL: "European",
  EG_DUAT: "Egyptian",
  GR_HADES: "Greek",
};

export function getCivilizationFromTenantCode(code: string): string {
  return TENANT_CODE_TO_CIVILIZATION[code] || code;
}

export function getTenantCodeFromCivilization(civ: string): string {
  return CIVILIZATION_CODES[civ as keyof typeof CIVILIZATION_CODES] || civ;
}

export function getDisplayNameForTenant(tenantCode: string): string {
  return CIVILIZATION_DISPLAY_NAMES[tenantCode] || tenantCode;
}
