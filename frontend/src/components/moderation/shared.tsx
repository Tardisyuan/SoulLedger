"use client";

import { moderationErrorCode } from "@soulledger/core/hooks/useSocialModeration";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import type { BadgeTone } from "@/src/components/ui/Badge";
import { DomainNumber } from "@/src/components/ui/DomainValue";
import type { ModeratedPost, ModerationReason } from "@soulledger/core/api/social-moderation";

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

/** 禁言天数的选项 —— 举报处置与「禁言…」共用。1–365,没有永久(产品决定;服务端同一上限)。 */
export const MUTE_DAYS = [1, 3, 7, 30, 90, 365];

/**
 * 隐藏 / 删除时必选的理由(2026-10-16 用户定),推给作者。与灵魂举报同一份(backend `ReportReason`),
 * 显示名 `social_moderation.reason.<code>`;OTHER 要再写一句,那句原样推给作者。
 */
export const MODERATION_REASONS: ModerationReason[] = ["SPAM", "ABUSE", "SEXUAL", "ILLEGAL", "OTHER"];
/** 服务端 `reason_note` 的上限(moderation_serializers.ModerationReasonFields)。 */
export const REASON_NOTE_MAX = 200;

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


/**
 * 帖子的评论数,按审核状态拆开:「评论 5 · 待审 2 · 已隐藏 1」。评论数(已发布)总是画;待审、已隐藏为 0 的不画。
 * 字用已有的词:「评论」是 `target_type.COMMENT`,「待审」「已隐藏」是 `moderation_status.*`。
 * 审核队列的详情与「已处理」的抽屉共用。
 */
export function CommentCounts({ post }: { post: Pick<ModeratedPost, "comment_count" | "pending_comment_count" | "hidden_comment_count"> }) {
  const { t } = useI18n();
  const parts = [
    { key: "published", label: t("social_moderation.target_type.COMMENT"), n: post.comment_count, always: true },
    { key: "pending", label: t("social_moderation.moderation_status.PENDING"), n: post.pending_comment_count, always: false },
    { key: "hidden", label: t("social_moderation.moderation_status.HIDDEN"), n: post.hidden_comment_count, always: false },
  ].filter((p) => p.always || p.n > 0);
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[oklch(var(--color-ink-muted))]" data-comment-counts>
      {parts.map((p, i) => (
        <span key={p.key} className="contents">
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>
            {p.label} <DomainNumber value={p.n} />
          </span>
        </span>
      ))}
    </div>
  );
}
