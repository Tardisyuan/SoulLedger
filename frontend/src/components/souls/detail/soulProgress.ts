import type { SoulState } from "@/src/lib/soulStateBadge";

/**
 * 户头进度(规范 v1 灵魂详情):01 存活 → 02 审判 → 03 处置 → 04 轮回。
 *
 * 「当前」只由 `current_state` 决定,不由有没有数据决定 —— 一个第二世的存活灵魂
 * 手里有上一世的判决与处置,但它这一世的户头停在 01。SETTLED(终局,埃及/欧洲的
 * 终点)停在 03:没有下一世可去。LOST 没有「当前」:不知道它丢在哪一步,所以
 * 只把有记录的步骤标为已过,不猜。
 */
export type StepStatus = "done" | "current" | "future";

const STATE_STEP: Record<SoulState, number | null> = {
  ALIVE: 0,
  JUDGING: 1,
  DISPOSED: 2,
  SETTLED: 2,
  REINCARNATING: 3,
  LOST: null,
};

export function stepStatuses(
  state: string | null | undefined,
  hasData: readonly boolean[]
): StepStatus[] {
  const cur = state && state in STATE_STEP ? STATE_STEP[state as SoulState] : null;
  return hasData.map((has, i) => {
    if (cur === null) return has ? "done" : "future";
    return i < cur ? "done" : i === cur ? "current" : "future";
  });
}

/** 按时间取最新的一条;`at` 返回 ISO 串,缺的排最后。 */
export function latest<T>(items: readonly T[], at: (item: T) => string | null | undefined): T | null {
  let best: T | null = null;
  let bestAt = "";
  for (const item of items) {
    const v = at(item) ?? "";
    if (best === null || v > bestAt) {
      best = item;
      bestAt = v;
    }
  }
  return best;
}
