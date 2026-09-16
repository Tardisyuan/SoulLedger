import { describe, expect, it } from "vitest";

import {
  cronFromPreset,
  joinCron,
  nextCronRuns,
  parseCronField,
  presetFromCron,
  splitCron,
  type CronFields,
  type CronPreset,
} from "../cron";

const cron = (text: string): CronFields => {
  const fields = splitCron(text);
  if (!fields) throw new Error(`not five fields: ${text}`);
  return fields;
};
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe("parseCronField mirrors celery's crontab_parser", () => {
  it("expands star, steps, ranges and lists", () => {
    expect(parseCronField("*/15", "minute")).toEqual([0, 15, 30, 45]);
    expect(parseCronField("*/3", "day_of_month").slice(0, 3)).toEqual([1, 4, 7]);
    expect(parseCronField("2-12/2", "month_of_year")).toEqual([2, 4, 6, 8, 10, 12]);
    expect(parseCronField("1,3,5", "day_of_week")).toEqual([1, 3, 5]);
  });

  it("reads names and wraps a reversed range the way celery does", () => {
    expect(parseCronField("mon-fri", "day_of_week")).toEqual([1, 2, 3, 4, 5]);
    expect(parseCronField("fri-mon", "day_of_week")).toEqual([0, 1, 5, 6]);
    expect(parseCronField("jan,dec", "month_of_year")).toEqual([1, 12]);
  });

  it.each([
    ["60", "minute"],
    ["24", "hour"],
    ["0", "day_of_month"],
    ["7", "day_of_week"],
    ["*/0", "minute"],
    ["1,,2", "minute"],
    ["abc", "hour"],
  ] as const)("refuses %s for %s", (spec, field) => {
    expect(() => parseCronField(spec, field)).toThrow();
  });
});

describe("splitCron / joinCron", () => {
  it("round-trips five fields and refuses any other count", () => {
    expect(joinCron(cron(" */5  *  * * * "))).toBe("*/5 * * * *");
    expect(splitCron("* * * *")).toBeNull();
    expect(splitCron("* * * * * *")).toBeNull();
    expect(splitCron("")).toBeNull();
  });
});

describe("nextCronRuns", () => {
  it("is strictly after the reference, in UTC", () => {
    const from = new Date("2026-09-17T03:30:00Z");
    expect(iso(nextCronRuns(cron("30 3 * * *"), "UTC", from))).toEqual([
      "2026-09-18T03:30:00.000Z",
      "2026-09-19T03:30:00.000Z",
      "2026-09-20T03:30:00.000Z",
    ]);
  });

  it("reads the hour in the job's zone, not UTC and not the host's", () => {
    // 08:00 in Shanghai; 09:00 Shanghai is 01:00Z the same day.
    const from = new Date("2026-09-17T00:00:00Z");
    expect(iso(nextCronRuns(cron("0 9 * * *"), "Asia/Shanghai", from, 2))).toEqual([
      "2026-09-17T01:00:00.000Z",
      "2026-09-18T01:00:00.000Z",
    ]);
  });

  it("crosses midnight: the local date differs from the UTC date", () => {
    // 16:30Z on the 17th is 00:30 on the 18th in Shanghai; today's 01:00 there
    // is 17:00Z on the UTC 17th.
    expect(
      iso(nextCronRuns(cron("0 1 * * *"), "Asia/Shanghai", new Date("2026-09-17T16:30:00Z"), 1))
    ).toEqual(["2026-09-17T17:00:00.000Z"]);
    // The direction that actually bites: 02:00Z on the 18th is still 19:00 on
    // the 17th in Los Angeles, so tonight's 23:00 (06:00Z on the 18th) is next.
    // A walk that starts from the UTC date begins on the 18th and skips it.
    expect(
      iso(nextCronRuns(cron("0 23 * * *"), "America/Los_Angeles", new Date("2026-09-18T02:00:00Z"), 1))
    ).toEqual(["2026-09-18T06:00:00.000Z"]);
  });

  it("matches day of week on the local date, Sunday = 0", () => {
    // Monday 01:00 in Shanghai is Sunday 17:00Z. 2026-09-16 is a Wednesday.
    const from = new Date("2026-09-16T00:00:00Z");
    expect(iso(nextCronRuns(cron("0 1 * * 1"), "Asia/Shanghai", from, 2))).toEqual([
      "2026-09-20T17:00:00.000Z",
      "2026-09-27T17:00:00.000Z",
    ]);
    expect(iso(nextCronRuns(cron("0 12 * * 0"), "UTC", from, 1))).toEqual(["2026-09-20T12:00:00.000Z"]);
  });

  it("ANDs day of month with day of week, as celery does (Friday the 13th)", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(iso(nextCronRuns(cron("0 0 13 * 5"), "UTC", from))).toEqual([
      "2026-02-13T00:00:00.000Z",
      "2026-03-13T00:00:00.000Z",
      "2026-11-13T00:00:00.000Z",
    ]);
  });

  it("resolves a spring-forward gap and a fall-back overlap like Python's fold=0", () => {
    // Values cross-checked against `datetime(..., tzinfo=ZoneInfo("Europe/Rome")).astimezone(UTC)`.
    expect(iso(nextCronRuns(cron("30 2 * * *"), "Europe/Rome", new Date("2026-03-28T12:00:00Z"), 2))).toEqual([
      "2026-03-29T01:30:00.000Z",
      "2026-03-30T00:30:00.000Z",
    ]);
    expect(iso(nextCronRuns(cron("30 2 * * *"), "Europe/Rome", new Date("2026-10-24T12:00:00Z"), 2))).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
    ]);
  });

  it("returns fewer runs for a schedule that never fires, instead of looping", () => {
    expect(nextCronRuns(cron("0 0 30 2 *"), "UTC", new Date("2026-01-01T00:00:00Z"))).toEqual([]);
  });

  it("throws on an unknown zone or bad field, so the form can say 'cannot preview'", () => {
    expect(() => nextCronRuns(cron("0 0 * * *"), "Mars/Olympus", new Date())).toThrow();
    expect(() => nextCronRuns(cron("99 0 * * *"), "UTC", new Date())).toThrow();
  });
});

describe("presets and raw text describe one schedule", () => {
  const PRESETS: CronPreset[] = [
    { kind: "every_n_minutes", interval: 1 },
    { kind: "every_n_minutes", interval: 5 },
    { kind: "hourly", minute: 0 },
    { kind: "hourly", minute: 45 },
    { kind: "daily", hour: 0, minute: 0 },
    { kind: "daily", hour: 3, minute: 30 },
    { kind: "weekly", weekday: 0, hour: 23, minute: 59 },
    { kind: "weekly", weekday: 6, hour: 4, minute: 0 },
  ];

  it.each(PRESETS.map((p) => [JSON.stringify(p), p] as const))("%s survives preset → text → preset", (_, preset) => {
    const fields = cronFromPreset(preset);
    expect(fields).not.toBeNull();
    expect(presetFromCron(fields!)).toEqual(preset);
  });

  it("recognises every default schedule in the backend registry", () => {
    expect(presetFromCron(cron("*/5 * * * *"))).toEqual({ kind: "every_n_minutes", interval: 5 });
    expect(presetFromCron(cron("*/15 * * * *"))).toEqual({ kind: "every_n_minutes", interval: 15 });
    expect(presetFromCron(cron("0 0 * * *"))).toEqual({ kind: "daily", hour: 0, minute: 0 });
    expect(presetFromCron(cron("30 3 * * *"))).toEqual({ kind: "daily", hour: 3, minute: 30 });
  });

  it.each([
    "*/5 */2 * * *",
    "0 0 1 * *",
    "0 0 * 1 *",
    "05 3 * * *",
    "0 9 * * 1-5",
    "0 9 * * mon",
    "* * * * *",
    "*/60 * * * *",
    "0,30 * * * *",
    "0 */2 * * *",
    "*/5 * * * 1",
    "0 * * * 1",
  ])("reads %s as custom rather than forcing it into a preset", (text) => {
    expect(presetFromCron(cron(text))).toEqual({ kind: "custom" });
  });

  it("writes no text for custom", () => {
    expect(cronFromPreset({ kind: "custom" })).toBeNull();
  });
});
