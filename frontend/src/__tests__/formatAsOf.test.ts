import { formatAsOf } from "@/src/lib/formatAsOf";

// Local-time constructors on purpose: "same day" is the viewer's calendar day, so the
// fixtures must not depend on the machine's time zone.
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fmt = (d: Date) => hhmm(d);
const NOW = new Date(2026, 9, 10, 14, 40);
const iso = (d: Date) => d.toISOString();

describe("formatAsOf", () => {
  it("same day: the time only, never 'just now'", () => {
    expect(formatAsOf(iso(new Date(2026, 9, 10, 14, 32)), NOW, fmt)).toBe("14:32");
  });

  it("another day this year: month-day and the time", () => {
    expect(formatAsOf(iso(new Date(2026, 9, 9, 0, 0)), NOW, fmt)).toBe("10-09 00:00");
  });

  it("another year: the year as well", () => {
    expect(formatAsOf(iso(new Date(2025, 11, 31, 23, 59)), NOW, fmt)).toBe("2025-12-31 23:59");
  });

  it("yesterday is not the same day, even a minute before midnight", () => {
    expect(formatAsOf(iso(new Date(2026, 9, 9, 23, 59)), NOW, fmt)).toBe("10-09 23:59");
  });

  it.each([[undefined], [null], [""], ["not a date"]])("%p: nothing to write", (value) => {
    expect(formatAsOf(value as string | null | undefined, NOW, fmt)).toBeNull();
  });

  it("leaves the clock to the formatter it is given (the current language)", () => {
    const calls: Array<Intl.DateTimeFormatOptions | undefined> = [];
    formatAsOf(iso(new Date(2026, 9, 10, 8, 5)), NOW, (_d, o) => {
      calls.push(o);
      return "8:05 AM";
    });
    expect(calls).toEqual([{ hour: "2-digit", minute: "2-digit" }]);
  });
});
