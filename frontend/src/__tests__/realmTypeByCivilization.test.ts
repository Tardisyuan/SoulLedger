/**
 * 界域类型按文明显示(v4 第八批第 7 条):数据与 RealmType 不动,`realmTypeNamespace` 只选命名空间。
 * 有 `realms.types_by_civ.<文明>.<类型>` 就用它,Design 标「不用」的组合与不认识的文明回落 `realms.types`。
 */
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zh from "@soulledger/core/messages/zh-Hans.json";

import { realmTypeNamespace } from "@/src/lib/domainNames";

const bundles = { zh, en, egy } as const;
const translator = (bundle: unknown) => (key: string) => {
  let cur: unknown = bundle;
  for (const seg of key.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[seg] : undefined;
  return typeof cur === "string" ? cur : key;
};
const t = translator(zh);

describe("realmTypeNamespace", () => {
  it("picks the civilization's word when Design gave one", () => {
    expect(t(`${realmTypeNamespace(t, "CHINESE", "BLISS")}.BLISS`)).toBe("天界");
    expect(t(`${realmTypeNamespace(t, "EGYPTIAN", "PURGATORY")}.PURGATORY`)).toBe("杜阿特");
    expect(t(`${realmTypeNamespace(t, "GREEK", "HELL")}.HELL`)).toBe("塔尔塔罗斯");
    // Absence: 地府 no longer reads 「天堂」.
    expect(t(`${realmTypeNamespace(t, "CHINESE", "BLISS")}.BLISS`)).not.toBe(t("realms.types.BLISS"));
  });

  it("falls back to realms.types for a combination Design marked unused, an unknown civilization, or none", () => {
    expect(realmTypeNamespace(t, "EGYPTIAN", "HELL")).toBe("realms.types");
    expect(realmTypeNamespace(t, "CHINESE", "ANNIHILATION")).toBe("realms.types");
    expect(realmTypeNamespace(t, "ATLANTEAN", "BLISS")).toBe("realms.types");
    expect(realmTypeNamespace(t, undefined, "BLISS")).toBe("realms.types");
  });

  it("the three bundles carry the same 16 keys", () => {
    const keys = (b: unknown) =>
      Object.entries((b as { realms: { types_by_civ: Record<string, Record<string, string>> } }).realms.types_by_civ)
        .flatMap(([civ, types]) => Object.keys(types).map((k) => `${civ}.${k}`))
        .sort();
    expect(keys(bundles.zh)).toHaveLength(16);
    expect(keys(bundles.en)).toEqual(keys(bundles.zh));
    expect(keys(bundles.egy)).toEqual(keys(bundles.zh));
  });
});
