/**
 * 「灵魂事件」页(/events,第三十七批 W-13)的纯函数:查询参数、×N 合并、细节列。
 * 与 React 无关,单测直接测(`SoulEventsPage.test.tsx`)。
 */
import type { SoulEvent, SoulEventListParams } from "@soulledger/core/api/events";
import { groupSystemEvents, sameSoulAndEvent, type SystemEventLabels } from "@/src/components/souls/soulLifecycleRows";
import { MISSING_GLYPH } from "@/src/lib/domainDisplay";

export type DatePreset = "" | "7d" | "30d";

export interface SoulEventFilters {
  search: string;
  eventType: string;
  actor: string;
  datePreset: DatePreset;
  includeSystem: boolean;
  page: number;
}

/**
 * 与审计日志的日期三档同一个算法(`app/audit/page.tsx`):从 N 天前到现在,只给 `start_date`。
 * `now` 由调用方给,测试才钉得住。
 */
export function eventListParams(f: SoulEventFilters, now: Date = new Date()): SoulEventListParams {
  const params: SoulEventListParams = { page: String(f.page) };
  const search = f.search.trim();
  if (search) params.search = search;
  if (f.eventType) params.event_type = f.eventType;
  if (f.actor) params.actor = f.actor;
  const start = startDate(f.datePreset, now);
  if (start) params.start_date = start;
  if (!f.includeSystem) params.exclude_system = "1";
  return params;
}

export function startDate(preset: DatePreset, now: Date = new Date()): string | undefined {
  if (!preset) return undefined;
  const from = new Date(now);
  from.setDate(from.getDate() - (preset === "7d" ? 7 : 30));
  return from.toISOString().slice(0, 10);
}

export interface SoulEventRow {
  key: string;
  /** The newest event of the run — its time and detail are what the row shows. */
  lead: SoulEvent;
  count: number;
}

/**
 * 相邻、同一灵魂、同一事件才合成一行(灵魂时间线的 `groupSystemEvents`,换一个更严的「同一组」)。
 * 全殿页上相邻的行多半是不同的灵魂,跨灵魂合并会把人藏掉。
 */
export function buildEventRows(events: SoulEvent[]): SoulEventRow[] {
  return groupSystemEvents(events, sameSoulAndEvent).map((g) => ({ key: g.key, lead: g.items[0], count: g.items.length }));
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** `+12` / `−4`(U+2212,同 Design 稿);老事件没有过的增量(只记了功),写「尚未记录」的 —。 */
function signed(n: unknown): string {
  if (typeof n !== "number") return MISSING_GLYPH.unrecorded;
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/**
 * 细节列:只有「状态变更」(旧 → 新 · 原因)和「功过重算」(功 ± · 过 ±)有内容,其余 null(格子画 —)。
 * 状态名走灵魂时间线同一份 `labels`(`souls.states.*`);原因是后端写进事件的自由文本,原样显示,
 * 同 `describeSystemEvent`。
 */
export function eventDetail(e: SoulEvent, labels: SystemEventLabels, t: Translate): string | null {
  const p = e.payload as Record<string, unknown>;
  if (e.event_type === "STATE_CHANGED") {
    const from = labels.state(typeof p.old_state === "string" ? p.old_state : null);
    const to = labels.state(typeof p.new_state === "string" ? p.new_state : null);
    const reason = typeof p.reason === "string" ? p.reason.trim() : "";
    const text = t("events.detail.state", { from, to, reason });
    // 三份语言包的句式都以「 · {{reason}}」收尾;没有原因时不留一个悬空的 ·。
    return reason ? text : text.replace(/\s*·\s*$/, "");
  }
  if (e.event_type === "KARMA_RECALCULATED") {
    return t("events.detail.karma", { merit: signed(p.delta), demerit: signed(p.demerit_delta) });
  }
  return null;
}
