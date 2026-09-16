/**
 * Five-field cron, the way the scheduler backend reads it — for the edit form's
 * "next three runs" preview and its preset ⇄ raw-text recognition.
 *
 * THE BACKEND IS THE AUTHORITY, AND THIS IS A MIRROR OF TWO FILES:
 *
 *   - field grammar: celery's `crontab_parser` (celery/schedules.py) — `*`,
 *     `*∕n`, `a`, `a-b` (wrapping when b < a), `a-b∕n`, comma lists, and
 *     three-letter month / weekday names. Day of week is 0–6 with Sunday = 0.
 *   - next-fire search: `apps/scheduler/services.py::next_fire_after` — a
 *     day-by-day walk over the parsed sets in the job's own time zone, where a
 *     day must match month AND day-of-month AND day-of-week (celery's `crontab`
 *     ANDs them; Vixie cron ORs day-of-month with day-of-week, which is the
 *     classic way to get this wrong), bounded at 367 days.
 *
 * The PATCH still validates with celery itself, so a spelling this mirror
 * rejects (or accepts) that celery does not only affects the preview, never
 * what is stored. The one known divergence is deliberate: celery matches its
 * patterns as prefixes (`"5junk"` is `5` to it); this parser anchors them, so
 * the preview says "cannot preview" for text the server would also most likely
 * refuse.
 *
 * No `Date` arithmetic in local time anywhere: the host's zone is irrelevant,
 * the JOB's zone is what counts, and it reaches the calculation only through
 * `Intl.DateTimeFormat({ timeZone })`. No dependency — `Intl` is enough and the
 * package must run on React Native too.
 */

export const CRON_FIELDS = ["minute", "hour", "day_of_month", "month_of_year", "day_of_week"] as const;
export type CronField = (typeof CRON_FIELDS)[number];
export type CronFields = Record<CronField, string>;

/** [min, max] inclusive, as `crontab_parser(max_, min_)` expands them. */
const RANGES: Record<CronField, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  day_of_month: [1, 31],
  month_of_year: [1, 12],
  day_of_week: [0, 6],
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** celery's `_expand_number`: an integer, else a month name, else a weekday name — in that order, for every field. */
function expandNumber(token: string, field: CronField): number {
  let value: number;
  if (/^\d+$/.test(token)) {
    value = Number(token);
  } else {
    const key = token.toLowerCase().slice(0, 3);
    const month = MONTHS.indexOf(key);
    const weekday = WEEKDAYS.indexOf(key);
    if (/^[a-z]+$/i.test(token) && month >= 0) value = month + 1;
    else if (/^[a-z]+$/i.test(token) && weekday >= 0) value = weekday;
    else throw new Error(`${field}: invalid token ${JSON.stringify(token)}`);
  }
  const [min, max] = RANGES[field];
  if (value < min || value > max) throw new Error(`${field}: ${value} outside ${min}-${max}`);
  return value;
}

function expandRange(from: string, to: string | undefined, field: CronField): number[] {
  const [min, max] = RANGES[field];
  const a = expandNumber(from, field);
  if (to === undefined) return [a];
  const b = expandNumber(to, field);
  const out: number[] = [];
  if (b < a) {
    for (let i = a; i <= max; i++) out.push(i);
    for (let i = min; i <= b; i++) out.push(i);
  } else {
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

function stepped(values: number[], step: string): number[] {
  const n = Number(step);
  if (!/^\d+$/.test(step) || n <= 0) throw new Error(`invalid step ${JSON.stringify(step)}`);
  return values.filter((_, i) => i % n === 0);
}

/** One field → the sorted set of values it fires on. Throws on text celery would not expand. */
export function parseCronField(spec: string, field: CronField): number[] {
  const [min, max] = RANGES[field];
  const acc = new Set<number>();
  for (const part of spec.trim().split(",")) {
    if (part === "") throw new Error(`${field}: empty part`);
    let m: RegExpExecArray | null;
    let values: number[];
    if ((m = /^(\w+?)-(\w+)\/(\w+)$/.exec(part))) values = stepped(expandRange(m[1], m[2], field), m[3]);
    else if ((m = /^(\w+?)-(\w+)$/.exec(part))) values = expandRange(m[1], m[2], field);
    else if ((m = /^\*\/(\w+)$/.exec(part))) {
      const all: number[] = [];
      for (let i = min; i <= max; i++) all.push(i);
      values = stepped(all, m[1]);
    } else if (part === "*") {
      values = [];
      for (let i = min; i <= max; i++) values.push(i);
    } else values = expandRange(part, undefined, field);
    for (const v of values) acc.add(v);
  }
  return [...acc].sort((x, y) => x - y);
}

export interface ParsedCron {
  minute: number[];
  hour: number[];
  day_of_month: Set<number>;
  month_of_year: Set<number>;
  day_of_week: Set<number>;
}

export function parseCron(fields: CronFields): ParsedCron {
  return {
    minute: parseCronField(fields.minute, "minute"),
    hour: parseCronField(fields.hour, "hour"),
    day_of_month: new Set(parseCronField(fields.day_of_month, "day_of_month")),
    month_of_year: new Set(parseCronField(fields.month_of_year, "month_of_year")),
    day_of_week: new Set(parseCronField(fields.day_of_week, "day_of_week")),
  };
}

/** "0 3 * * *" → fields; null unless there are exactly five whitespace-separated fields. */
export function splitCron(text: string): CronFields | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === "") return null;
  const [minute, hour, day_of_month, month_of_year, day_of_week] = parts;
  return { minute, hour, day_of_month, month_of_year, day_of_week };
}

export function joinCron(fields: CronFields): string {
  return CRON_FIELDS.map((f) => fields[f]).join(" ");
}

// ── Time zones ──────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Throws RangeError for an unknown zone — callers treat that as "cannot preview".
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The zone's UTC offset at `instant`, in milliseconds (east positive). */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of wallClockFormatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/**
 * Wall-clock time in `timeZone` → instant, resolved the way Python's
 * `datetime(..., tzinfo=ZoneInfo(tz))` resolves it (fold=0), because that is
 * what the backend's `next_fire_after` builds:
 *   - ambiguous (clocks fall back): the EARLIER of the two instants;
 *   - nonexistent (clocks spring forward): shifted by the pre-transition
 *     offset, so 02:30 in a 02:00→03:00 gap lands on 03:30.
 */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const DAY = 86_400_000;
  const before = zoneOffsetMs(naive - DAY, timeZone);
  const after = zoneOffsetMs(naive + DAY, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => naive - offset)
    .filter((t) => zoneOffsetMs(t, timeZone) === naive - t);
  if (valid.length > 0) return Math.min(...valid);
  return naive - before;
}

/** The calendar date `instant` falls on in `timeZone`. */
function zonedDate(instant: number, timeZone: string): { year: number; month: number; day: number } {
  const local = new Date(instant + zoneOffsetMs(instant, timeZone));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

/**
 * The next `count` fire times strictly after `from`, as `Date`s.
 *
 * Throws on unparseable fields or an unknown zone; returns fewer than `count`
 * when the schedule runs out inside the 367-day window (e.g. `0 0 30 2 *`).
 */
export function nextCronRuns(fields: CronFields, timeZone: string, from: Date, count = 3): Date[] {
  const cron = parseCron(fields);
  const start = zonedDate(from.getTime(), timeZone);
  const out: Date[] = [];
  for (let offset = 0; offset < 367 && out.length < count; offset++) {
    // Date.UTC normalises day overflow, so this walks calendar days with no DST in the way.
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const month = d.getUTCMonth() + 1;
    if (
      !cron.month_of_year.has(month) ||
      !cron.day_of_month.has(d.getUTCDate()) ||
      !cron.day_of_week.has(d.getUTCDay()) // Sunday = 0, same as celery
    ) {
      continue;
    }
    for (const hour of cron.hour) {
      for (const minute of cron.minute) {
        const t = zonedWallTimeToInstant(d.getUTCFullYear(), month, d.getUTCDate(), hour, minute, timeZone);
        if (t > from.getTime()) {
          out.push(new Date(t));
          if (out.length === count) return out;
        }
      }
    }
  }
  return out;
}

// ── Presets ─────────────────────────────────────────────────────────────────

/**
 * The four shapes the edit form offers. A preset is a *reading* of the raw
 * text, not a second source of truth: `presetFromCron` recognises exactly the
 * text `cronFromPreset` writes, and everything else is `custom`. That is what
 * keeps the two views of one schedule from disagreeing — the property the
 * tests pin is `presetFromCron(cronFromPreset(p))` deep-equals `p`.
 */
export type CronPreset =
  | { kind: "every_n_minutes"; interval: number }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "custom" };

export type CronPresetKind = CronPreset["kind"];

/** A plain decimal in range with no leading zero — "05" is not what the form would write. */
function plainInt(text: string, min: number, max: number): number | null {
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export function presetFromCron(fields: CronFields): CronPreset {
  const { minute, hour, day_of_month, month_of_year, day_of_week } = fields;
  if (day_of_month !== "*" || month_of_year !== "*") return { kind: "custom" };

  const step = /^\*\/(.+)$/.exec(minute);
  if (step && hour === "*" && day_of_week === "*") {
    const interval = plainInt(step[1], 1, 59);
    return interval === null ? { kind: "custom" } : { kind: "every_n_minutes", interval };
  }
  const m = plainInt(minute, 0, 59);
  if (m === null) return { kind: "custom" };
  if (hour === "*") return day_of_week === "*" ? { kind: "hourly", minute: m } : { kind: "custom" };
  const h = plainInt(hour, 0, 23);
  if (h === null) return { kind: "custom" };
  if (day_of_week === "*") return { kind: "daily", hour: h, minute: m };
  const w = plainInt(day_of_week, 0, 6);
  return w === null ? { kind: "custom" } : { kind: "weekly", weekday: w, hour: h, minute: m };
}

/** Null for `custom`: there is no text to write, the raw fields are the value. */
export function cronFromPreset(preset: CronPreset): CronFields | null {
  const rest = { day_of_month: "*", month_of_year: "*" };
  switch (preset.kind) {
    case "every_n_minutes":
      return { minute: `*/${preset.interval}`, hour: "*", ...rest, day_of_week: "*" };
    case "hourly":
      return { minute: String(preset.minute), hour: "*", ...rest, day_of_week: "*" };
    case "daily":
      return { minute: String(preset.minute), hour: String(preset.hour), ...rest, day_of_week: "*" };
    case "weekly":
      return {
        minute: String(preset.minute),
        hour: String(preset.hour),
        ...rest,
        day_of_week: String(preset.weekday),
      };
    case "custom":
      return null;
  }
}
