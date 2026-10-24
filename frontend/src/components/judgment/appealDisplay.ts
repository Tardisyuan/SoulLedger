import { APPEAL_ERROR_CODES, type JudgmentAppealStatus, type JudgmentClaimRefusal } from "@soulledger/core/api";
import type { BadgeTone } from "@/src/components/ui/Badge";

/** 申诉状态 → 徽章色调。改判不是失败,撤回也不是:中性;复核中是进行中。 */
export const APPEAL_STATUS_TONES: Record<JudgmentAppealStatus, BadgeTone> = {
  PENDING: "neutral",
  IN_REVIEW: "info",
  UPHELD: "neutral",
  AMENDED: "ink",
  WITHDRAWN: "neutral",
};

export type AppealRefusal = { code: string; foreignOrders?: number[] };

/** 认领 / 决定被拒:服务端的 `code`(没有就是 null —— 网络或别的错误)。 */
export function appealRefusalOf(err: unknown): AppealRefusal | null {
  const data = (err as { response?: { data?: Partial<JudgmentClaimRefusal> } })?.response?.data;
  return data?.code ? { code: data.code, foreignOrders: data.foreign_orders } : null;
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
