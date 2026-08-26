/**
 * 仪表盘 KPI 的千位分组。原先长在 app/dashboard/page.tsx 里，那个文件越过仓库
 * 500 行的上限之后搬到这里；`StatCard` 与页面里的每租户卡片都读它，所以它是
 * 共用的而不是 StatCard 私有的。逻辑逐字未改。
 */

/**
 * 千位分隔用窄不断行空格 U+202F,不用逗号。
 *
 * KPI 走 `tabular-nums`,那让**数字**等宽,对标点不作任何承诺 —— 逗号的宽度
 * 仍由字族决定,于是「1,234」与「9,999」之间那一格是唯一一处宽度不确定的
 * 字形,四张卡片右对齐时它会把整列推歪。U+202F 是排版里专门给数字分组的那个
 * 空格(不断行,所以「12 345」不会在换行处被劈成两半)。
 *
 * 只分组整数部分:小数位不分组,而这里唯一的小数是均值余额。
 */
const GROUP_SEPARATOR = "\u202F";

export function groupDigits(value: number): string {
  const negative = value < 0;
  const digits = String(Math.trunc(Math.abs(value)));
  return (negative ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}
