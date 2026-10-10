type FormatDateTime = (value: Date, options?: Intl.DateTimeFormatOptions) => string;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 「数据截至」后面的那段时间(规范 v3 A4):同一天只写时分,不是同一天写「月-日 时:分」,
 * 跨年补年份。「同一天」「跨年」按用户所在时区的日历算(浏览器时区,和 `formatDateTime` 一致);
 * 时分由 `formatDateTime`(当前语言)排。接口没给时间、或给的不是时间,返回 null ——
 * 调用方整句不写,不放占位。
 */
export function formatAsOf(
  asOf: string | null | undefined,
  now: Date,
  formatDateTime: FormatDateTime,
): string | null {
  if (!asOf) return null;
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return null;

  const time = formatDateTime(at, { hour: "2-digit", minute: "2-digit" });
  if (at.getFullYear() !== now.getFullYear()) {
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
  }
  if (at.getMonth() !== now.getMonth() || at.getDate() !== now.getDate()) {
    return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
  }
  return time;
}
