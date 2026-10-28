import type { components } from "../api/generated/schema";

type Station = components["schemas"]["DiyuStationEnum"];

/**
 * 地府十三站(`DiyuStation`,docs/06 §一 总览表的次序)。界面画「第 n / 13 站」读这份数组的次序。
 * 在 domain 里而不是 api/souls.ts:灵魂端 App 也要读它,而 souls.ts 是官员端的接口。
 */
export const DIYU_STATIONS = [
  "TUDI_TEMPLE",
  "YELLOW_SPRINGS_ROAD",
  "WANGXIANG_TERRACE",
  "EVIL_DOG_VILLAGE",
  "GOLDEN_ROOSTER_HILL",
  "WILD_GHOST_VILLAGE",
  "MIHUN_HALL",
  "OFFERING_PAVILION",
  "GHOST_FORT",
  "FENGDU_CITY",
  "EIGHTEEN_HELLS",
  "LOTUS_TERRACE",
  "HUANHUN_CLIFF",
] as const satisfies readonly Station[];

/** 第几站(1-13);"" 或认不出是 null。 */
export function diyuStationOrdinal(station: string | null | undefined): number | null {
  const at = (DIYU_STATIONS as readonly string[]).indexOf(station ?? "");
  return at < 0 ? null : at + 1;
}
