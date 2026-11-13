/**
 * 顶栏的时辰(v4 第七批 S01 `hours.*`):按**观看者**所在时区的钟点,换成该文明的时辰名。
 * 文书上的时辰不按观看者 —— 它按落印所在殿的时区写死(用户 2026-11-06 决定 D12):`verdictDocument.ts` 取
 * `concluded_at_local` 串里的钟点,再交给下面的 `civilHourAt`。
 *
 * - 地府:十二时辰,子时 23:00–00:59 起,每两小时一辰(子丑寅卯辰巳午未申酉戌亥)。
 * - 欧洲:八个祈祷时辰(Horae canonicae),各自管到下一个开始:夜祷 0 · 晨祷 3 · 晨时 6 · 三时 9 ·
 *   六时 12 · 九时 15 · 晚祷 18 · 夜终 21。定稿的样张 15:40 是「九时」,与此一致。
 * - 埃及:昼 6:00–17:59;夜分十二时(《阿姆杜阿特》的夜之十二时),18:00 是第 1 时,05:xx 是第 12 时。
 * - 希腊:昼 / 夜,界线同埃及。
 * 昼夜一律按 6 / 18 切,不按日出日落:后者要观看者的经纬度,而顶栏只知道时区。
 *
 * 纯函数、只读 `Date` 的本地钟点(`getHours()` = 运行环境的时区 = 观看者),web 与两个 App 共用。
 */
export type HourCiv = "cn" | "eu" | "eg" | "gr";

export type CivilHour = { key: string; params?: Record<string, string> };

const CN = ["zi", "chou", "yin", "mao", "chen", "si", "wu", "wei", "shen", "you", "xu", "hai"] as const;
const EU = ["matins", "lauds", "prime", "terce", "sext", "none", "vespers", "compline"] as const;

const isDay = (h: number) => h >= 6 && h < 18;

/** 钟点(0–23)→ 时辰的语言包键;不在 0–23 的整数抛错(调用方传错了,不该静默给一个名字)。 */
export function civilHourAt(civ: HourCiv, hour: number): CivilHour {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError(`hour must be 0–23, got ${hour}`);
  switch (civ) {
    case "cn":
      return { key: `hours.cn.${CN[Math.floor(((hour + 1) % 24) / 2)]}` };
    case "eu":
      return { key: `hours.eu.${EU[Math.floor(hour / 3)]}` };
    case "eg":
      return isDay(hour) ? { key: "hours.eg.day" } : { key: "hours.eg.night", params: { n: String(((hour + 6) % 24) + 1) } };
    case "gr":
      return { key: isDay(hour) ? "hours.gr.day" : "hours.gr.night" };
  }
}

/** 观看者此刻的时辰。`date` 默认现在。 */
export const civilHour = (civ: HourCiv, date: Date = new Date()): CivilHour => civilHourAt(civ, date.getHours());
