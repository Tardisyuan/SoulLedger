/**
 * 立柱什么时候改横排(规范 v2 补足 C14):所有一级项都 ≤ 4 个汉字、≤ 8 个拉丁字符时竖排 60;
 * 只要有一项超过,**整根**改横排 88(11px,最多两行)—— 一根柱子里竖横混排读不下去。
 *
 * 按字符数判断,不按渲染宽度:竖排的高度与横排的宽度是两件事,量哪个都会把阈值变成
 * 字体的函数;C14 写的就是字数。汉字按 `\p{Script=Han}` 数,其余(字母、空格、标点)
 * 按拉丁字符数 —— 「Sesh Nefer Isfet」是 16 个,「组织与领域」是 5 个汉字,都改横排。
 *
 * C14 要求与 App 底栏共用一个判断函数;App 在 `mobile/`,这份目前只有 Web 在用。
 */
const HAN = /\p{Script=Han}/u;

export function labelTooLongForVerticalPillar(label: string): boolean {
  const chars = Array.from(label.trim());
  const han = chars.filter((c) => HAN.test(c)).length;
  return han > 4 || chars.length - han > 8;
}

export const pillarIsWide = (labels: readonly string[]): boolean => labels.some(labelTooLongForVerticalPillar);
