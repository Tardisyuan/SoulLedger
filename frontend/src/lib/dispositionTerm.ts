import type { Disposition } from "@soulledger/core/api";
import type { HistoricalDate } from "@soulledger/core/domain/dates";

/**
 * 处置页「执行中」一段的期限条 TermBar 读数。
 *
 * 分段不在这里算了:期满由服务端的每日期满检查写下 `expired_at`,页面按 `?section=` 取三段
 * (`apps/disposition/models.py` 的 `SECTION_FILTERS`)。这里只回答「期限条画到哪」:
 * 起点是 `term_start`,终点是服务端算好的 `term_end`(与期满检查同一个算法)。服务端没给
 * `term_end` 而起点与年限都在时才自己加年限 —— 旧载荷的兜底,不是另一套判定。
 *
 * 过了终点、检查还没跑到的行(检查一天一次)仍是「执行中」:条画满、余 0 天,
 * 不在前端把它挪进「期满」。
 */
export type TermState =
  | { kind: "eternal" }
  /** 非永恒却没记期限(希腊 FAILED 的正常情形,见 Disposition.sentence_years 的注释)。 */
  | { kind: "no_term" }
  | { kind: "no_start"; years: number }
  | { kind: "running"; start: HistoricalDate; end: HistoricalDate; fraction: number; daysLeft: number };

const DAY_MS = 86_400_000;

// ponytail: 公元前年份按 JS 天文纪年(0 年存在)换算,跨越公元元年的刑期会差一年;要精确就换成
// 与后端 apps/souls/dates.py 同一套纪年换算。
function toMs(date: HistoricalDate): number {
  const d = new Date(0);
  d.setUTCFullYear(date.year, (date.month ?? 1) - 1, date.day ?? 1);
  return d.getTime();
}

export function termState(
  d: Pick<Disposition, "is_eternal" | "sentence_years" | "term_start" | "term_end">,
  now: number
): TermState {
  if (d.is_eternal) return { kind: "eternal" };
  const years = d.sentence_years;
  if (years === null || years === undefined) return { kind: "no_term" };
  const start = d.term_start;
  if (!start) return { kind: "no_start", years };
  const end: HistoricalDate = d.term_end ?? { ...start, year: start.year + years };
  const from = toMs(start);
  const to = toMs(end);
  return {
    kind: "running",
    start,
    end,
    fraction: to > from ? Math.min(1, Math.max(0, (now - from) / (to - from))) : 1,
    daysLeft: Math.max(0, Math.ceil((to - now) / DAY_MS)),
  };
}
