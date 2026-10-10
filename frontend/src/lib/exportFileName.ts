const UNSAFE = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 导出文件名「页面名-殿名-YYYYMMDD-HHmm.csv」:时间取用户本地时区;
 * 文件系统不认的字符(`/ \ : * ? " < > |` 与控制字符)换成下划线。
 */
export function exportFileName(page: string, hall: string | undefined, now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return [page, hall, stamp].filter(Boolean).join("-").replace(UNSAFE, "_") + ".csv";
}
