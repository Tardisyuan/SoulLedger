/**
 * The two city god statuses that keep a case away from the ten courts (claim / defer / conclude answer 409
 * `at_city_god`). In `domain/`, not `api/`: many web tests mock `@soulledger/core/api` wholesale, and a constant
 * imported from there reads as undefined under that mock (2026-10-24, nine suites).
 */
export const AT_CITY_GOD: readonly string[] = ["PENDING", "RETURNED"];

export function isAtCityGod(status: string | null | undefined): boolean {
  return !!status && AT_CITY_GOD.includes(status);
}

/** 城隍四级(docs/08 §二),从高到低;后端 `CityGodRank`。未定级的城隍是空串。 */
export const CITY_GOD_RANKS = ["PROVINCE", "PREFECTURE", "DEPARTMENT", "COUNTY"] as const;

/**
 * 城隍的司按部分组(docs/08 §三):阴阳司为首,其下吏、户、礼、兵、刑、工六部各四司。成员与后端 `CityGodBureau`
 * 相同、顺序相同(`backend/tests/test_diyu_offence_wangsi_city_god.py` 对照)。只用于显示与编辑抽屉的分组。
 */
export const CITY_GOD_BUREAU_GROUPS: readonly { ministry: string; bureaus: readonly string[] }[] = [
  { ministry: "HEAD", bureaus: ["YINYANG"] },
  { ministry: "PERSONNEL", bureaus: ["GONGCAO", "DIANJI", "JIBU", "DUGUAN"] },
  { ministry: "REVENUE", bureaus: ["CAIBO", "TUDI", "LIANGMO", "KAOJIE"] },
  { ministry: "RITES", bureaus: ["JISI", "YIZHU", "HUOFU", "MINGYI"] },
  { ministry: "WAR", bureaus: ["BINGZHANG", "XINGXUN", "JUBU", "XUNCHA"] },
  { ministry: "JUSTICE", bureaus: ["XINGFA", "ANBU", "QUANDIAN", "XUMING"] },
  { ministry: "WORKS", bureaus: ["YINGZAO", "QIAODAO", "CIJI", "SHUYUN"] },
];

/**
 * 各级城隍通常设的司 —— 编辑抽屉「按{级别}预设」一键勾上的那一组(Design 第五十七批 D-3)。
 *
 * **这是工程按文档提的方案,不是文献里的名单**(2026-10-28,第五十七批补表第二节):docs/08 只说「级别越高诸司越齐全」,
 * 没给每级的名单。县级取接引、记功过、拘魂、审案、押送这些办一件死亡案必经的司;往上逐级补齐;都城隍全设。
 * 预设之后照样可以逐个改。合计:县 10 司、州 18 司、府 23 司、都 25 司。
 */
const COUNTY_BUREAUS = ["YINYANG", "GONGCAO", "JIBU", "TUDI", "KAOJIE", "JISI", "XINGXUN", "JUBU", "ANBU", "SHUYUN"] as const;
const DEPARTMENT_BUREAUS = [
  ...COUNTY_BUREAUS, "DIANJI", "DUGUAN", "CAIBO", "YIZHU", "HUOFU", "XUNCHA", "XINGFA", "QIAODAO",
] as const;
const PREFECTURE_BUREAUS = [...DEPARTMENT_BUREAUS, "LIANGMO", "MINGYI", "BINGZHANG", "QUANDIAN", "YINGZAO"] as const;

export const CITY_GOD_BUREAU_PRESETS: Readonly<Record<(typeof CITY_GOD_RANKS)[number], readonly string[]>> = {
  COUNTY: COUNTY_BUREAUS,
  DEPARTMENT: DEPARTMENT_BUREAUS,
  PREFECTURE: PREFECTURE_BUREAUS,
  PROVINCE: CITY_GOD_BUREAU_GROUPS.flatMap((g) => g.bureaus),
};
