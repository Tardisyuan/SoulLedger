import { APPEAL_ERROR_CODES, type JudgmentAppealStatus, type JudgmentClaimRefusal } from "@soulledger/core/api";
import type { BadgeTone } from "@/src/components/ui/Badge";
import { DOSSIER_TAG } from "@/src/components/ui/StatusBadge";
import { responseCode, responseData } from "@soulledger/core/api/client";

/** 申诉状态 → 徽章色调。改判不是失败,撤回也不是:中性;复核中是进行中。 */
export const APPEAL_STATUS_TONES: Record<JudgmentAppealStatus, BadgeTone> = {
  PENDING: "neutral",
  IN_REVIEW: "info",
  UPHELD: "error",
  AMENDED: "ink",
  WITHDRAWN: "neutral",
  // 灵魂被阿米特吞噬，申诉随之作废(P2-10)。
  VOID: "neutral",
};

/**
 * 申诉被驳回(维持原判)的字形是 ⊘(第三十批第 3 步第 5 条),不取色调默认的 ✕ —— ✕ 留给「已驳回」。
 * 别的状态用色调的默认字形。`statusGlyphFont.test.ts` 读这张表,字形必须在字体里。
 */
export const APPEAL_STATUS_GLYPHS: Partial<Record<JudgmentAppealStatus, string>> = {
  UPHELD: DOSSIER_TAG.appealRejected.glyph,
};

export type AppealRefusal = { code: string; foreignOrders?: number[] };

/** 认领 / 决定被拒:服务端的 `code`(没有就是 null —— 网络或别的错误)。 */
export function appealRefusalOf(err: unknown): AppealRefusal | null {
  const code = responseCode(err);
  return code ? { code, foreignOrders: responseData<JudgmentClaimRefusal>(err)?.foreign_orders } : null;
}

type T = (key: string, params?: Record<string, string>) => string;

/** 一次被拒,译成一句话;认不出的码落到认领那一族的通用句,不回显服务端英文。 */
export function appealRefusalMessage(err: unknown, t: T): string {
  const code = appealRefusalOf(err)?.code;
  return code && (APPEAL_ERROR_CODES as readonly string[]).includes(code)
    ? t(`appeals.error.${code}`)
    : t("judgment.claim.refused.generic");
}

/** 弹层里就地说、不关弹层的两种(W-3b):过一会儿可以再点。 */
export const APPEAL_IN_DIALOG_CODES = ["plan_in_transit", "plan_busy"];
