"use client";

import { useToggleReaction, useReactions } from "@soulledger/core/hooks/useSocial";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * The five reactions as glyph + word, not emoji. Glyphs and labels are the
 * soul app's own (`mobile/src/screens/circle.tsx` REACTIONS, `soul_app.circle.react.*`),
 * so an officer and a soul read the same mark for the same reaction. The lamp
 * has no glyph there (it is drawn as an icon), so here it is the word alone.
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
  { type: "ETERNAL_LIGHT", glyph: "", key: "soul_app.circle.react.eternal_light" },
];

interface ReactionBarProps {
  postId?: string;
  commentId?: string;
}

export function ReactionBar({ postId, commentId }: ReactionBarProps) {
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

  return (
    <div className="flex items-center gap-1 mt-2">
      {REACTIONS.map(({ type, glyph, key }) => {
        const isActive = myReaction === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => handleToggle(type)}
            disabled={toggleReaction.isPending}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1 h-7 px-2 text-xs border transition-colors duration-150 ease-out disabled:cursor-not-allowed ${
              isActive
                ? "border-[oklch(var(--color-accent))] text-[oklch(var(--color-accent-ink))]"
                : "border-transparent text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]"
            }`}
            title={type}
          >
            {glyph && <span aria-hidden="true">{glyph}</span>}
            {t(key)}
          </button>
        );
      })}
    </div>
  );
}
