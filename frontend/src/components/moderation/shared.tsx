"use client";

import { moderationErrorCode } from "@soulledger/core/hooks/useSocialModeration";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import type { BadgeTone } from "@/src/components/ui/Badge";

/**
 * Shared by the four /moderation segments (E 组 08 / 08b / 08c / 08d).
 */

/** 审核状态 → tone;字形由 `StatusBadge` 配(规范 v1 §1.2,不只靠颜色)。未列出的一律 neutral。 */
export const MODERATION_TONES: Record<string, BadgeTone> = {
  PUBLISHED: "success",
  PENDING: "warning",
  HIDDEN: "error",
  DELETED: "ink",
};

/** 「命中后」三种动作的颜色(E-08b):送审警示、隐藏危险、替换为 *** 是墨色。 */
export const WORD_ACTION_TONES: Record<string, BadgeTone> = {
  REVIEW: "warning",
  HIDE: "error",
  MASK: "neutral",
};

/** A server refusal in words: `{detail, code}` → `social_moderation.errors.<code>`. */
export function useFailureToast() {
  const { t } = useI18n();
  const { showToast } = useToast();
  return (error: unknown) => {
    const code = moderationErrorCode(error);
    showToast(code ? t(`social_moderation.errors.${code}`) : t("social_moderation.failed"), "error");
  };
}

/**
 * Single-letter shortcuts are ignored while the operator types: A / H / J / K
 * in the reason box are letters, not verdicts.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** A table header cell in the ledger style (mono 11 px, block rule under the row). */
export const TH = "px-3 py-2 text-left font-normal";
export const TD = "px-3 py-2 align-middle";
