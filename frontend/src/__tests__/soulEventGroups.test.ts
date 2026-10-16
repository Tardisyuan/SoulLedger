/**
 * 「灵魂事件」页(/events,第三十七批 W-13)的纯函数:事件分组、查询参数、×N 合并、细节列。
 *
 * 分组守卫的主体清单不是手写的:灵魂时间线上的类型 = 后端镜像 `BACKEND_EVENT_TYPES` 里
 * 在 `souls.events.*` 有名字的那些。时间线加了一个类型而没给它分组,下拉里就找不到它 —— 这里红。
 */
import zhHans from "@soulledger/core/messages/zh-Hans.json";
import type { SoulEvent } from "@soulledger/core/api/events";
import { BACKEND_EVENT_TYPES, SOUL_EVENT_GROUPS, isSystemActor } from "@/lib/events/event_registry";
import { groupSystemEvents, makeSystemEventLabels } from "@/src/components/souls/soulLifecycleRows";
import { buildEventRows, eventDetail, eventListParams } from "@/src/components/events/soulEventRows";
import { tZh } from "./support/zhBundle";

const grouped = Object.values(SOUL_EVENT_GROUPS).flat() as string[];

describe("SOUL_EVENT_GROUPS", () => {
  it("puts every type the soul timeline names into exactly one group", () => {
    const backend = new Set<string>(BACKEND_EVENT_TYPES);
    const timeline = Object.keys(zhHans.souls.events).filter((type) => backend.has(type));
    expect(timeline.length).toBeGreaterThan(30);
    expect(timeline.filter((type) => !grouped.includes(type))).toEqual([]);
    expect(grouped.filter((type, i) => grouped.indexOf(type) !== i)).toEqual([]);
  });

  it("holds no type the backend does not have, and no type the timeline does not name", () => {
    const backend = new Set<string>(BACKEND_EVENT_TYPES);
    const named = new Set(Object.keys(zhHans.souls.events));
    expect(grouped.filter((type) => !backend.has(type) || !named.has(type))).toEqual([]);
  });

  it("is the six groups Design named, each with a heading in the bundle", () => {
    expect(Object.keys(SOUL_EVENT_GROUPS)).toEqual(["lifecycle", "workflow", "dispatch", "death_sync", "account", "punishment"]);
    for (const group of Object.keys(SOUL_EVENT_GROUPS)) {
      expect(tZh(`events.groups.${group}`)).not.toBe(`events.groups.${group}`);
    }
  });
});

describe("isSystemActor", () => {
  it("is the blank actor and the literal EventService writes, nothing else", () => {
    expect(isSystemActor("")).toBe(true);
    expect(isSystemActor("system")).toBe(true);
    expect(isSystemActor(null)).toBe(true);
    expect(isSystemActor("cui")).toBe(false);
    expect(isSystemActor("System Admin")).toBe(false);
  });
});

describe("eventListParams", () => {
  const base = { search: "", eventType: "", actor: "", datePreset: "7d" as const, includeSystem: false, page: 1 };
  const now = new Date("2026-10-17T12:00:00Z");

  it("defaults to the last 7 days without system events", () => {
    expect(eventListParams(base, now)).toEqual({ page: "1", start_date: "2026-10-10", exclude_system: "1" });
  });

  it("drops exclude_system when 含系统事件 is ticked, and start_date for 全部", () => {
    const params = eventListParams({ ...base, includeSystem: true, datePreset: "" }, now);
    expect(params).toEqual({ page: "1" });
    expect(params).not.toHaveProperty("exclude_system");
    expect(params).not.toHaveProperty("start_date");
  });

  it("sends search, type, actor and 30 days as the server's names", () => {
    expect(
      eventListParams({ ...base, search: "  阿满 ", eventType: "STATE_CHANGED", actor: "cui", datePreset: "30d", page: 3 }, now)
    ).toEqual({ page: "3", search: "阿满", event_type: "STATE_CHANGED", actor: "cui", start_date: "2026-09-17", exclude_system: "1" });
  });
});

function event(over: Partial<SoulEvent>): SoulEvent {
  return { id: "e", soul: "s1", soul_name: "周阿满", event_type: "KARMA_RECALCULATED", payload: {}, actor: "meng", create_time: "2026-10-17T10:00:00Z", ...over };
}

describe("buildEventRows (×N)", () => {
  it("merges adjacent rows with the same soul and the same event, newest first", () => {
    const rows = buildEventRows([
      event({ id: "a", create_time: "2026-10-17T11:48:00Z", payload: { delta: 12 } }),
      event({ id: "b", create_time: "2026-10-17T11:40:00Z" }),
      event({ id: "c", create_time: "2026-10-17T11:30:00Z", actor: "other" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    expect(rows[0].lead.id).toBe("a");
  });

  it("never merges across souls, even for the same event back to back", () => {
    const rows = buildEventRows([
      event({ id: "a", soul: "s1", create_time: "2026-10-17T11:48:00Z" }),
      event({ id: "b", soul: "s2", create_time: "2026-10-17T11:47:00Z" }),
      event({ id: "c", soul: "s1", create_time: "2026-10-17T11:46:00Z" }),
    ]);
    expect(rows.map((r) => [r.lead.id, r.count])).toEqual([["a", 1], ["b", 1], ["c", 1]]);
  });

  it("does not merge the same soul across different events", () => {
    const rows = buildEventRows([
      event({ id: "a", event_type: "STATE_CHANGED" }),
      event({ id: "b", event_type: "KARMA_RECALCULATED", create_time: "2026-10-17T09:00:00Z" }),
    ]);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });

  it("leaves the soul timeline's own rule as it was (same event, actor and instant)", () => {
    const at = "2026-10-17T10:00:00Z";
    expect(groupSystemEvents([event({ id: "a", create_time: at }), event({ id: "b", create_time: at })])).toHaveLength(1);
    expect(groupSystemEvents([event({ id: "a" }), event({ id: "b", create_time: "2026-10-17T09:00:00Z" })])).toHaveLength(2);
  });
});

describe("eventDetail", () => {
  const labels = makeSystemEventLabels(tZh);

  it("writes a state change as 旧 → 新 · 原因, with state names from souls.states", () => {
    const text = eventDetail(
      event({ event_type: "STATE_CHANGED", payload: { old_state: "ALIVE", new_state: "JUDGING", reason: "认领" } }),
      labels,
      tZh
    );
    expect(text).toBe(`${tZh("souls.states.ALIVE")} → ${tZh("souls.states.JUDGING")} · 认领`);
    expect(text).not.toContain("ALIVE");
  });

  it("leaves no dangling · when the change has no reason", () => {
    const text = eventDetail(event({ event_type: "STATE_CHANGED", payload: { old_state: "ALIVE", new_state: "JUDGING" } }), labels, tZh);
    expect(text).toBe(`${tZh("souls.states.ALIVE")} → ${tZh("souls.states.JUDGING")}`);
  });

  it("writes a recalculation as signed merit and demerit deltas", () => {
    expect(eventDetail(event({ payload: { delta: 12, demerit_delta: -4 } }), labels, tZh)).toBe("功 +12 · 过 −4");
    expect(eventDetail(event({ payload: { delta: 0 } }), labels, tZh)).toBe("功 0 · 过 —");
  });

  it("is null for every other event", () => {
    expect(eventDetail(event({ event_type: "WORKFLOW_CREATED", payload: { reason: "x" } }), labels, tZh)).toBeNull();
    expect(eventDetail(event({ event_type: "DEATH_SYNC_RECEIVED" }), labels, tZh)).toBeNull();
  });
});
