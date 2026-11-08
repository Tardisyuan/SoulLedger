/**
 * The demo store reads /events/'s two non-column filters the way the server does (apps/events/views.py): a day range on
 * create_time, both ends inclusive, and exclude_system = actor empty or "system". Unread, any day but the recording's
 * showed every event, system ones too, under 「近 7 天 · 不含系统事件」.
 */
import { read, type Recording } from "@/demo/store";

const ev = (id: string, actor: string, create_time: string) => ({ id, actor, create_time, event_type: "STATE_CHANGED" });
const rec: Recording = {
  role: "judge",
  lang: "zh",
  recordedAt: "2026-11-08T00:00:00Z",
  login: { user: {} },
  lists: {
    "/events/": {
      rows: [
        ev("a", "system", "2026-11-07T10:00:00Z"),
        ev("b", "", "2026-11-07T10:00:00Z"),
        ev("c", "heibai", "2026-11-07T10:00:00Z"),
        ev("d", "heibai", "2026-10-01T10:00:00Z"),
        ev("e", "heibai", "-000278-06-09T10:00:00Z"),
      ],
      extra: {},
    },
  },
  docs: {},
};
const ids = (q: string) => ((read(rec, "/events/", new URLSearchParams(q)).data as { results: { id: string }[] }).results.map((r) => r.id).sort());

it("exclude_system drops actor empty or system", () => {
  expect(ids("exclude_system=1")).toEqual(["c", "d", "e"]);
  expect(ids("")).toEqual(["a", "b", "c", "d", "e"]);
});

it("start_date / end_date bound the day, both ends inclusive, BCE included", () => {
  expect(ids("exclude_system=1&start_date=2026-11-01")).toEqual(["c"]);
  expect(ids("start_date=2026-11-07&end_date=2026-11-07")).toEqual(["a", "b", "c"]);
  expect(ids("end_date=2026-10-01")).toEqual(["d", "e"]);
});
