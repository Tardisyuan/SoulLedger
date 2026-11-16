/**
 * 「最近用过」的驳回理由(便利性审查 D8,Design 第五十二批 F1 / 第五十六批):这位官员最近三次被服务端收下的驳回理由。
 * 官员端 App 的 `mobile-officer/src/memory.ts` 在手机上记同一样东西;这里是网页那一份,按用户分键、只在这台浏览器里
 * (同 `recentOpened.ts`)。没有用户时不读不写;每一次读写都兜住:记不住只是少几行。
 */
export const RECENT_REASONS = 3;
/** 最长的理由框(2000);更长的不是在这里写的。 */
const REASON_MAX = 2000;

const reasonsKey = (userId: number | string) => `soulledger.reject.recent.${userId}`;

/** 新的在前,最多三条,每条非空。 */
export function readReasons(userId: number | string | null | undefined): string[] {
  if (userId === undefined || userId === null) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(reasonsKey(userId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is string => typeof r === "string" && r.trim() !== "" && r.length <= REASON_MAX).slice(0, RECENT_REASONS);
  } catch {
    return [];
  }
}

/** 服务端收下一次驳回之后调:这条放最前,同样的字不记两次。 */
export function rememberReason(userId: number | string | null | undefined, reason: string): void {
  const text = reason.trim();
  if (userId === undefined || userId === null || !text || text.length > REASON_MAX) return;
  try {
    const next = [text, ...readReasons(userId).filter((r) => r !== text)].slice(0, RECENT_REASONS);
    window.localStorage.setItem(reasonsKey(userId), JSON.stringify(next));
  } catch {
    /* 隐私模式等:这一次不记。 */
  }
}

/** 点一行:框是空的就填进去,不空就另起一行加在后面(不覆盖);不超过框的上限。 */
export function withReason(current: string, reason: string, max = REASON_MAX): string {
  return (current.trim() ? `${current}\n${reason}` : reason).slice(0, max);
}
