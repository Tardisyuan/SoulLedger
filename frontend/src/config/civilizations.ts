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

/**
 * The two-letter prefix each civilization is keyed by outside this file —
 * `cn` / `eu` / `eg` / `gr` — derived from the tenant code rather than typed.
 *
 * This rule already existed three times and was declared "written once" in the
 * only place it was actually derived. `TenantContext` computes it inline as
 * `tenantCode.split("_")[0].toLowerCase()` and then checks the result against a
 * literal or-chain; `globals.css` spells the four out as `[data-civ="cn"]` …
 * rules; and `src/__tests__/support/globalsCssTokens.ts` derives it from
 * `CIVILIZATION_CODES` under a comment reading "The one prefix rule, written
 * once" — true of that file and of nothing else, because a helper under
 * `__tests__/` cannot be imported by the code it describes.
 *
 * Deriving it here is what makes that comment a fact: the masthead reads this,
 * `TenantContext` reads this, and the test helper reads this. A fifth
 * civilization gets its prefix from the tenant code it already had to declare
 * above, so the only place that still needs a hand edit is the stylesheet —
 * which is exactly the enumeration `civilizationColourContract` holds against
 * this list, and the gap GREEK slipped through.
 *
 * Not `as const`: the value is derived, so its keys are `string` and a caller
 * that wants exhaustiveness should be iterating CIVILIZATION_OPTIONS.
 */
export const CIVILIZATION_SHORT_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(CIVILIZATION_CODES).map(([civ, tenantCode]) => [
    civ,
    tenantCode.split("_")[0].toLowerCase(),
  ])
);

/** The same four prefixes as a set, for "is this a civilization we paint?". */
export const CIVILIZATION_SHORT_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(CIVILIZATION_SHORT_CODES)
);

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

/**
 * The four cosmologies as single glyphs, for the two places that group by
 * civilization (`/organizations`, `/actors`).
 *
 * THESE ARE EMOJI ON PURPOSE, and the reasoning is measured — see the comments
 * inside the map. It is the one place in the app where an emoji beats a Lucide
 * icon: these are identity marks, not chrome, and the alternative that was
 * tried (the Egyptian hieroglyph U+132F4) renders as tofu in every font
 * available here.
 *
 * IT LIVES HERE BECAUSE IT USED TO LIVE TWICE. The same twelve lines were
 * copied into `app/organizations/page.tsx` and `app/actors/page.tsx`, and by
 * 2026-09-02 the two copies had already drifted: the values still agreed, the
 * comments did not — only one of them recorded that Greek gained Hades,
 * Aeacus, Rhadamanthus and Minos in `realms/0018`. Values that agree today and
 * comments that disagree is the state right before the values disagree too.
 */
export const CIVILIZATION_ICONS: Record<string, string> = {
  CHINESE: "🏯",
  EUROPEAN: "⛪",
  // U+132F4 (hieroglyph S029) sat here and rendered as tofu anywhere
  // `Noto Sans Egyptian Hieroglyphs` is absent — measured: it is in none of
  // Apple Color Emoji, Apple Symbols, Arial Unicode or DejaVu Sans. U+26B1 is
  // RGI emoji, so it is in every colour-emoji font; the trailing U+FE0F is
  // load-bearing because DejaVu Sans *does* cover bare U+26B1 and would draw
  // it monochrome next to three colour neighbours.
  EGYPTIAN: "⚱️",
  // Hades, Aeacus, Rhadamanthus and Plato's Minos are GREEK since realms/0018.
  GREEK: "🏛",
};

/** Drawn when a record's civilization is not one of the four. */
export const CIVILIZATION_ICON_FALLBACK = "🌍";
