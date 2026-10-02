"use client";

import { useToggleReaction, useReactions } from "@soulledger/core/hooks/useSocial";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * The five reactions as glyph + word, not emoji. Glyphs and labels are the
 * soul app's own (`mobile/src/screens/circle.tsx` REACTIONS, `soul_app.circle.react.*`),
 * so an officer and a soul read the same mark for the same reaction. The lamp
 * has no glyph there (it is drawn as an icon); here it is ◉, as 补足 C17 draws it.
 *
 * A5(v3 Post.dc):四种轻表态是 44 高的方角按钮;1px × 24 竖分隔之后,**长明灯单独一格**,
 * Noto Serif SC 600(稿上写明;用 `font-title` 而不是 `font-serif`:后者是「引文」那一支,
 * 拉丁字会落到 Source Serif 4),未点 = 1px ink 描边,
 * 已点 = ink 实底 surface-1 字(反白)。v2 的胶囊 + 长明灯色框随 v3 撤掉。
 * 选中不靠颜色:aria-pressed + 加粗,长明灯还换字(「点长明灯」→「长明灯已点」)。
 * ≤ 768 轻表态只显示字形(名字留给读屏),长明灯换短字。
 *
 * 计数(`Post.reaction_counts`,五种各自的数):照 A5 稿「轻表态只计总数;长明灯单独一格,
 * 不与其他四种并排计数」—— 右端「表态 N」是四种轻表态之和,长明灯的数写在它自己那一格里
 * (有人点过才写)。没给 `counts`(评论)就退回 `totals.reactions`。
 */
export const REACTIONS: {
  type: "LIKE" | "LOVE" | "RESPECT" | "SYMPATHY" | "ETERNAL_LIGHT";
  glyph: string;
  key: string;
}[] = [
  { type: "LIKE", glyph: "◇", key: "soul_app.circle.react.like" },
  { type: "LOVE", glyph: "♡", key: "soul_app.circle.react.love" },
  { type: "RESPECT", glyph: "△", key: "soul_app.circle.react.respect" },
  { type: "SYMPATHY", glyph: "○", key: "soul_app.circle.react.sympathy" },
  { type: "ETERNAL_LIGHT", glyph: "◉", key: "soul_app.circle.react.eternal_light" },
];

const LIGHT = REACTIONS.filter((r) => r.type !== "ETERNAL_LIGHT");

interface ReactionBarProps {
  postId?: string;
  commentId?: string;
  /** 帖子卡右端的「表态 N · 评论 N」;评论里不给。 */
  totals?: { reactions: number; comments: number };
  /** 五种表态各自的数(`Post.reaction_counts`)。 */
  counts?: Record<(typeof REACTIONS)[number]["type"], number>;
}

export function ReactionBar({ postId, commentId, totals, counts }: ReactionBarProps) {
  const { user } = useTenant();
  const { t } = useI18n();
  const toggleReaction = useToggleReaction();
  const { data } = useReactions(
    postId ? { post: postId } : commentId ? { comment: commentId } : undefined,
  );
  const reactions = data?.results ?? [];

  const myReaction = reactions.find(
    (r) => String(r.user) === String(user?.id),
  )?.reaction_type;

  const handleToggle = (type: string) => {
    if (!postId && !commentId) return;
    toggleReaction.mutate({
      post: postId,
      comment: commentId,
      reaction_type: type,
    });
  };

  const lit = myReaction === "ETERNAL_LIGHT";
  const lamps = counts?.ETERNAL_LIGHT ?? 0;
  const lightTotal = counts ? LIGHT.reduce((sum, r) => sum + (counts[r.type] ?? 0), 0) : totals?.reactions;
  const base =
    "inline-flex h-(--control-h-sm) min-w-(--control-h-sm) shrink-0 items-center justify-center gap-1 text-sm transition-colors duration-fast ease-standard disabled:cursor-not-allowed";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {LIGHT.map(({ type, glyph, key }) => {
        const isActive = myReaction === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => handleToggle(type)}
            disabled={toggleReaction.isPending}
            aria-pressed={isActive}
            data-reaction={type}
            className={`${base} px-2 ${
              isActive
                ? "bg-[oklch(var(--color-surface-2))] font-semibold text-[oklch(var(--color-ink))]"
                : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]"
            }`}
          >
            <span aria-hidden="true">{glyph}</span>
            <span className="max-[768px]:sr-only">{t(key)}</span>
          </button>
        );
      })}
      <span aria-hidden="true" className="mx-[6px] h-6 w-px bg-[oklch(var(--color-line))]" />
      <button
        type="button"
        onClick={() => handleToggle("ETERNAL_LIGHT")}
        disabled={toggleReaction.isPending}
        aria-pressed={lit}
        data-reaction="ETERNAL_LIGHT"
        className={`${base} border border-[oklch(var(--color-ink))] px-[14px] font-title font-semibold ${
          lit
            ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))]"
            : "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
        }`}
      >
        <span aria-hidden="true">◉</span>
        <span className="max-[768px]:hidden">{t(lit ? "social.lamp.lit" : "social.lamp.light")}</span>
        <span className="min-[769px]:hidden">
          {t(lit ? "social.lamp.lit_short" : "soul_app.circle.react.eternal_light")}
        </span>
        {lamps > 0 && (
          <span data-testid="lamp-count" className="font-mono font-normal tabular-nums">
            {lamps}
          </span>
        )}
      </button>
      {totals ? (
        <span className="ml-auto text-xs text-[oklch(var(--color-ink-muted))]" data-testid="post-totals">
          <span className="max-[768px]:sr-only">{t("social.reactions")} </span>
          <span className="font-mono tabular-nums">{lightTotal}</span>
          {" · "}
          <span className="max-[768px]:sr-only">{t("social.comments")} </span>
          <span className="font-mono tabular-nums">{totals.comments}</span>
        </span>
      ) : null}
    </div>
  );
}
