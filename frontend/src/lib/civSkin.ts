import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

const CIV_SKINS = new Set(Object.values(CIVILIZATION_SHORT_CODES));

/**
 * 文明皮:`CN_DIYU` → `cn`;不认得的代码与未登录 → `neutral`。
 *
 * 单独成模块,不放在 TenantContext 里:印组件要用它,而几十份测试把 TenantContext 整个
 * mock 成只有 `useTenant` 的对象 —— 放在那里,每一份渲染到印的测试都会拿到 undefined。
 */
export function civSkinOf(tenantCode: string | null): string {
  const prefix = tenantCode?.split("_")[0].toLowerCase();
  return prefix && CIV_SKINS.has(prefix) ? prefix : "neutral";
}
