import type { Disposition } from "@soulledger/core/api";
import type { HistoricalDate } from "@soulledger/core/domain/dates";

/**
 * 处置页(规范 v1 第三类 A·07)的三段:待执行 → 执行中 → 期满。
 *
 * 后端没有「期满」这个状态,也没有到期检查在跑(celery beat 未部署),所以这一段由两个
 * 记录过的事实算出:`term_start`(刑期从哪天起算)加 `sentence_years`。缺一个就不算 ——
 * 起算没记录的留在「执行中」并说明缺什么,不拿 `executed_at` 顶替(模型注释写明了两者
 * 是两件事)。永恒处置不计时,永远不期满。
 */
export type TermState =
  | { kind: "eternal" }
  /** 非永恒却没记期限(希腊 FAILED 的正常情形,见 Disposition.sentence_years 的注释)。 */
  | { kind: "no_term" }
  | { kind: "no_start"; years: number }
  | { kind: "running"; start: HistoricalDate; end: HistoricalDate; fraction: number; daysLeft: number }
  | { kind: "served"; start: HistoricalDate; end: HistoricalDate };

export type DispositionSection = "pending" | "running" | "expired";

const DAY_MS = 86_400_000;

// ponytail: 公元前年份按 JS 天文纪年(0 年存在)换算,跨越公元元年的刑期会差一年;要精确就换成
// 与后端 apps/souls/dates.py 同一套纪年换算。
function toMs(date: HistoricalDate): number {
  const d = new Date(0);
  d.setUTCFullYear(date.year, (date.month ?? 1) - 1, date.day ?? 1);
  return d.getTime();
}

export function termState(d: Pick<Disposition, "is_eternal" | "sentence_years" | "term_start">, now: number): TermState {
  if (d.is_eternal) return { kind: "eternal" };
  const years = d.sentence_years;
  if (years === null || years === undefined) return { kind: "no_term" };
  const start = d.term_start;
  if (!start) return { kind: "no_start", years };
  const end: HistoricalDate = { ...start, year: start.year + years };
  const from = toMs(start);
  const to = toMs(end);
  if (now >= to) return { kind: "served", start, end };
  return {
    kind: "running",
    start,
    end,
    fraction: to > from ? Math.max(0, (now - from) / (to - from)) : 1,
    daysLeft: Math.ceil((to - now) / DAY_MS),
  };
}

export function sectionOf(d: Disposition, now: number): DispositionSection {
  if (!d.is_executed) return "pending";
  return termState(d, now).kind === "served" ? "expired" : "running";
}
