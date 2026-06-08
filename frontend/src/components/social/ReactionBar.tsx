"use client";

import { useToggleReaction, useReactions } from "@/src/hooks/useSocial";
import { useTenant } from "@/src/contexts/TenantContext";

const REACTION_EMOJIS: Record<string, string> = {
  LIKE: "👍",
  LOVE: "❤️",
  RESPECT: "🙏",
  SYMPATHY: "🕊️",
  ETERNAL_LIGHT: "✨",
};

interface ReactionBarProps {
  postId?: string;
  commentId?: string;
}

export function ReactionBar({ postId, commentId }: ReactionBarProps) {
  const { user } = useTenant();
  const toggleReaction = useToggleReaction();
  const { data } = useReactions(
    postId ? { post: postId } : commentId ? { comment: commentId } : undefined,
  );
  const reactions = (data?.results ?? []) as Array<{
    reaction_type: string;
    user: string;
  }>;

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
      {Object.entries(REACTION_EMOJIS).map(([type, emoji]) => {
        const isActive = myReaction === type;
        return (
          <button
            key={type}
            onClick={() => handleToggle(type)}
            disabled={toggleReaction.isPending}
            className={`text-sm px-2 py-1 rounded-lg transition-colors ${
              isActive
                ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                : "hover:bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]"
            }`}
            title={type}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}
