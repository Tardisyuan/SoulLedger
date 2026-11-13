import { courtSlug } from "@soulledger/core/domain/courts";
import { diyuStationOrdinal } from "@soulledger/core/domain/diyuStations";

/**
 * 卷宗脊上的「现在」(Design 第三十批 第 3 步第 2 条):灵魂此刻在哪一站。脊的形状四家各一,位置由这里算。
 * 输入全是已有字段 —— 地府读 `Soul.diyu_station`(十三站)与审判的 `court`(第几殿);其余三家读
 * `GET /souls/{id}/path/` 里没离开的那一站(`left_at` 为 null)的 `realm_code`,没有就按 `current_state` 推。
 * 认不出就是 null:脊照画,没有 metal 点 —— 不猜一个位置。
 */
export type SpineCiv = "cn" | "eu" | "eg" | "gr";

export type SpineNow =
  /** 地府:前九站(1–9,土地庙 … 鬼门关)、十殿之一(1–10)、地狱支线(挂在第 n 殿下)、轮回。 */
  | { civ: "cn"; at: "pre"; n: number }
  | { civ: "cn"; at: "hall"; n: number }
  | { civ: "cn"; at: "hell"; n: number }
  | { civ: "cn"; at: "rebirth" }
  /** 欧洲:米诺斯门前(待判),或判入第 n 圈。 */
  | { civ: "eu"; at: "gate" }
  | { civ: "eu"; at: "circle"; n: number }
  /** 埃及:杜阿特之门(入殿前)、天平(称心)、芦苇原、湮灭。 */
  | { civ: "eg"; at: "gate" | "scale" | "aaru" | "annihilation" }
  /** 希腊:阿刻戎渡口、三岔(待判)、至福岛 / 阿斯福得草原 / 塔尔塔罗斯。 */
  | { civ: "gr"; at: "ferry" | "fork" | "isles" | "asphodel" | "tartarus" };

export interface SpineInput {
  civilization: string | null | undefined;
  currentState?: string | null;
  diyuStation?: string | null;
  court?: string | null;
  /** 当前所在界域的 `realm_code`(path 里未离开的那一站)。 */
  realmCode?: string | null;
}

const CIV: Record<string, SpineCiv> = { CHINESE: "cn", EUROPEAN: "eu", EGYPTIAN: "eg", GREEK: "gr" };
export const spineCivOf = (civilization: string | null | undefined): SpineCiv | null => CIV[civilization ?? ""] ?? null;

const ORDINAL: Record<string, number> = { "1ST": 1, "2ND": 2, "3RD": 3, "4TH": 4, "5TH": 5, "6TH": 6, "7TH": 7, "8TH": 8, "9TH": 9 };

/** `court_N` → N(第几殿);别的殿名 null。 */
export function hallOf(court: string | null | undefined): number | null {
  const m = /^court_(\d+)$/.exec(courtSlug(court) ?? "");
  return m ? Number(m[1]) : null;
}

export function spineNow(input: SpineInput): SpineNow | null {
  const civ = spineCivOf(input.civilization);
  const realm = input.realmCode ?? "";
  const judging = input.currentState === "JUDGING";
  switch (civ) {
    case "cn": {
      const at = diyuStationOrdinal(input.diyuStation);
      const hall = hallOf(input.court);
      if (input.currentState === "REINCARNATING" || (at !== null && at >= 12)) return { civ, at: "rebirth" };
      if (at === 11) return { civ, at: "hell", n: hall ?? 1 };
      if (at === 10 || (at === null && judging && hall)) return { civ, at: "hall", n: hall ?? 1 };
      if (at !== null) return { civ, at: "pre", n: at };
      return null;
    }
    case "eu": {
      const circle = /^EU_HELL_(\d(?:ST|ND|RD|TH))$/.exec(realm);
      if (circle) return { civ, at: "circle", n: ORDINAL[circle[1]] };
      return judging || realm === "EU_ACHERON" || realm === "EU_ANTINFERNO" ? { civ, at: "gate" } : null;
    }
    case "eg":
      if (realm === "EG_AARU") return { civ, at: "aaru" };
      if (realm === "EG_ANNIHILATION" || realm === "EG_DEVOURER") return { civ, at: "annihilation" };
      if (realm === "EG_HALL_TWO_TRUTHS" || judging) return { civ, at: "scale" };
      return realm.startsWith("EG_") ? { civ, at: "gate" } : null;
    case "gr":
      if (realm === "GR_ISLES_OF_THE_BLESSED") return { civ, at: "isles" };
      if (realm === "GR_ASPHODEL_MEADOW" || realm === "GR_PLATO_MEADOW") return { civ, at: "asphodel" };
      if (realm === "GR_TARTARUS") return { civ, at: "tartarus" };
      if (realm === "GR_ACHERON") return { civ, at: "ferry" };
      return realm === "GR_HADES" || judging ? { civ, at: "fork" } : null;
    default:
      return null;
  }
}
