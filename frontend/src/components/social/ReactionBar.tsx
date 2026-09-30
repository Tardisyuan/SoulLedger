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
 * 规范 v2 补足 C17:五种对齐现有表态,**长明灯在末位**(`REACTIONS` 的顺序就是渲染顺序,
 * ReactionBar.test 钉住)。四种普通表态是 32 高的方角按钮、1px ink3 框;长明灯是胶囊、
 * 2px 长明灯色框 —— 圆角的例外里只有胶囊(A2),长明灯色不和警示共用。选中不靠颜色:
 * aria-pressed + 加粗,普通表态再加 s2 底与 ink 框,长明灯是实底块(「有」)。
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
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {REACTIONS.map(({ type, glyph, key }) => {
        const isActive = myReaction === type;
        const lamp = type === "ETERNAL_LIGHT";
        const look = lamp
          ? isActive
            ? "rounded-[9999px] border-2 border-[oklch(var(--color-lamp))] bg-[oklch(var(--color-lamp))] text-[oklch(var(--color-lamp-bg))] font-semibold"
            : "rounded-[9999px] border-2 border-[oklch(var(--color-lamp))] text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
          : isActive
            ? "border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink))] font-semibold"
            : "border border-[oklch(var(--color-ink-subtle))] text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]";
        return (
          <button
            key={type}
            type="button"
            onClick={() => handleToggle(type)}
            disabled={toggleReaction.isPending}
            aria-pressed={isActive}
            data-reaction={type}
            className={`inline-flex items-center gap-1 h-8 px-3 text-sm transition-colors duration-fast ease-standard disabled:cursor-not-allowed ${look}`}
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
