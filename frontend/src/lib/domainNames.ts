import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { localName } from "@soulledger/core/domain/localName";

type T = (key: string) => string;

const BUILTIN_ROLES = new Set(["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER", "SOUL"]);

/**
 * 角色的名字。内置角色只读语言包(`users.roles.*`):库里的 `display_name` 是种子写的英文(「Moderator」),
 * 中文界面下直接露出来,而同一个角色在筛选里叫「殿主」。自建角色的名字是数据,读 `display_name`。
 */
export function roleLabel(t: T, name: string, role?: { display_name?: string | null } | null): string {
  return BUILTIN_ROLES.has(name) ? t(`users.roles.${name}`) : role?.display_name || name;
}

/**
 * 殿的名字。四个种子殿读语言包(`organization.civilizations.*`):库里是「Chinese Afterlife」,`/realms`
 * 叫它「中国地府」。后来建的殿不在语言包里,读库里的名字。
 */
export function tenantLabel(
  t: T,
  tenant: { code?: string | null; display_name?: string | null; display_name_en?: string | null } | null | undefined,
  locale?: string,
): string {
  const civilization = TENANT_CODE_TO_CIVILIZATION[tenant?.code ?? ""];
  if (civilization) return t(`organization.civilizations.${civilization}`);
  return localName(tenant, locale, "display_name") || tenant?.code || "";
}
