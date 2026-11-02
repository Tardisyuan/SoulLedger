/**
 * Sections on the ledger pages are numbered 甲乙丙…: a Chinese way of counting that means nothing in another language, and
 * reads there as stray characters. Every language but Chinese gets letters.
 */
const LETTERS: Record<string, string> = { 甲: "A", 乙: "B", 丙: "C", 丁: "D", 戊: "E", 己: "F", 庚: "G", 辛: "H" };

export function sectionMark(mark: string, locale?: string): string {
  return locale === undefined || locale === "zh-Hans" ? mark : (LETTERS[mark] ?? mark);
}
