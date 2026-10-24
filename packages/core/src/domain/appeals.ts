/**
 * 审判申诉(第五十二批)两端共用的纯规则。接口在 `api/judgment.ts`(官员)与 `api/soul.ts`(灵魂)。
 */

/** 每件审判最多申诉两次,撤回也算一次(backend `appeals.APPEAL_MAX_ROUNDS`)。 */
export const APPEAL_MAX_ROUNDS = 2;

/** 改判补偿:已执行的每一站一笔 COMPENSATION 功德(`AppealCompensationSerializer`;生成的类型把它写成 unknown[])。 */
export interface AppealCompensation {
  id: string;
  weight: number;
  /** 后端写的「申诉改判补偿:{案号} 第 N 站(租户),原判 X → Y」。 */
  description: string;
}

/** 补偿那一笔的站序:接口不单给,从后端写的说明里取「第 N 站」;原处置(不在计划里)没有站序 → null。 */
export function compensationOrder(c: Pick<AppealCompensation, "description">): number | null {
  const m = /第\s*(\d+)\s*站/.exec(c.description);
  return m ? Number(m[1]) : null;
}

/**
 * 撤回确认里「还能申诉 {left} 次」:2 − 这件审判已经提过的轮数(含正在撤回的这一轮)。
 * 0 时用 `withdraw_body_last`(第五十二批,用户决定)。
 */
export function appealsLeftAfterWithdraw(roundsFiled: number): number {
  return Math.max(0, APPEAL_MAX_ROUNDS - roundsFiled);
}
