import { CIVILIZATION_SHORT_CODES, TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
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

/**
 * 界域类型的显示词,按文明(v4 第八批第 7 条):数据与 `RealmType` 不动,只换显示 —— 地府没有「天堂」,
 * 埃及的 PURGATORY 是杜阿特。有 `realms.types_by_civ.<文明>.<类型>` 就用那个命名空间,没有(Design 标「不用」的组合、
 * 不认识的文明)就回落到四文明共用的 `realms.types`。给 `<DomainEnum namespace={…}>` 用。
 */
export function realmTypeNamespace(t: T, civilization: string | null | undefined, type: string | null | undefined): string {
  const civ = civilization ? CIVILIZATION_SHORT_CODES[civilization] : undefined;
  const ns = `realms.types_by_civ.${civ}`;
  return civ && type && t(`${ns}.${type}`) !== `${ns}.${type}` ? ns : "realms.types";
}
