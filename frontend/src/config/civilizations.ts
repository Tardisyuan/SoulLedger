// Civilization and tenant code mappings

export const CIVILIZATION_CODES = {
  CHINESE: "CN_DIYU",
  EUROPEAN: "EU_HEAVEN_HELL",
  EGYPTIAN: "EG_DUAT",
} as const;

export const TENANT_CODE_TO_CIVILIZATION: Record<string, string> = {
  CN_DIYU: "CHINESE",
  EU_HEAVEN_HELL: "EUROPEAN",
  EG_DUAT: "EGYPTIAN",
};

export const CIVILIZATION_LABELS: Record<string, string> = {
  CHINESE: "中国地府",
  EUROPEAN: "欧洲天堂地狱",
  EGYPTIAN: "埃及冥界",
};

export const CIVILIZATION_DISPLAY_NAMES: Record<string, string> = {
  CN_DIYU: "Chinese",
  EU_HEAVEN_HELL: "European",
  EG_DUAT: "Egyptian",
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
