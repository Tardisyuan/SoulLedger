"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useDeletePost } from "@soulledger/core/hooks/useSocial";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { ReactionBar } from "./ReactionBar";
import type { Post } from "@soulledger/core/api";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Badge, type BadgeTone } from "@/src/components/ui/Badge";

/**
 * Visibility, in the app's badge tones.
 *
 * These four used to be hand-written light/dark pairs — `bg-green-100
 * text-green-800 dark:bg-green-900/30 dark:text-green-400` and three more —
 * which made this the **only component in the codebase running its own theme
 * system**. Of the ten `dark:` utilities in the whole frontend, six were here.
 * It worked, which is what made it durable: a private parallel implementation
 * of the thing `.light`/`:root` already do, immune to every contrast
 * measurement the token layer carries and to the user's accent choice.
 *
 * `Badge` is the one tone table (its own docstring: "THIS IS NOW THE ONLY TONE
 * TABLE"), and its fills are measured — 10%, because columns.tsx recorded that
 * 16% drops light-mode badge text to 4.37:1.
 *
 * Square like every badge (规范 v1: round corners are for avatars only).
 */
const VISIBILITY_TONES: Record<string, BadgeTone> = {
  PUBLIC: "success",
  TENANT: "info",
  FOLLOWERS: "accent",
  PRIVATE: "neutral",
};

export function PostCard({ post }: { post: Post }) {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const deletePost = useDeletePost();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isAuthor = !!user && String(user.id) === String(post.author);

  const handleDelete = () => {
    if (deletePost.isPending) return;
    deletePost.mutate(post.id, { onSuccess: () => setShowDeleteConfirm(false) });
  };

  // Hover was `hover:shadow-xs transition-shadow` — an elevation cue on an
  // in-flow card, where `DESIGN.md:50-57` puts the layering on the hairline.
  // The hairline-strong step is the same affordance in the system's own
  // vocabulary, and is what `app/realms/page.tsx` already uses for a hoverable
  // card.
  return (
    <div className="bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-hairline))] p-4 hover:border-[oklch(var(--color-hairline-strong))] transition-colors duration-state">
      <div className="flex items-center gap-3 mb-3">
        <Link
          href={`/social/profile/${post.author}`}
          className="text-sm font-medium text-[oklch(var(--color-ink))] hover:underline"
        >
          {post.author_name || post.author_username}
        </Link>
        <Badge tone={VISIBILITY_TONES[post.visibility] ?? "neutral"}>
          <DomainEnum namespace="social.visibility" value={post.visibility} />
        </Badge>
        <span className="text-xs font-mono tabular-nums text-[oklch(var(--color-ink-muted))] ml-auto">
          {formatDate(post.create_time)}
        </span>
        {isAuthor && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            aria-label={t("common.delete") || "Delete"}
            className="text-xs text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-status-error))] transition-colors"
          >
            {t("common.delete") || "Delete"}
          </button>
        )}
      </div>

      <Link href={`/social/${post.id}`} className="block">
        <p className="text-sm text-[oklch(var(--color-ink))] whitespace-pre-wrap">
          {post.content}
        </p>
      </Link>

      <div className="flex items-center gap-4 mt-3 text-xs font-mono tabular-nums text-[oklch(var(--color-ink-muted))]">
        {/* 文字 + 数字,不是 emoji(规范 v1:图标不用 emoji,状态与计数都要读得出来)。 */}
        <span>
          {t("social.comments")} {post.comment_count}
        </span>
        <span>
          {t("social.reactions")} {post.reaction_count}
        </span>
      </div>

      <ReactionBar postId={post.id} />

      {isAuthor && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title={t("common.confirm_delete") || "Confirm Delete"}
          message={t("social.delete_post_confirm") || "Are you sure you want to delete this post? This cannot be undone."}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmText={deletePost.isPending ? (t("common.deleting") || "Deleting...") : (t("common.delete") || "Delete")}
          variant="danger"
        />
      )}
    </div>
  );
}
