"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useDeletePost } from "@/src/hooks/useSocial";
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
 * `pill`, deliberately: Badge's docstring reserves the rounded shape for
 * identity rather than state, and visibility is a property of the post's
 * audience — closer to a tag than to a status. It was already `rounded-full`
 * here.
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

  return (
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 hover:shadow-xs transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <Link
          href={`/social/profile/${post.author}`}
          className="text-04 font-medium text-[hsl(var(--color-ink))] hover:underline"
        >
          {post.author_name || post.author_username}
        </Link>
        <Badge tone={VISIBILITY_TONES[post.visibility] ?? "neutral"} shape="pill">
          <DomainEnum namespace="social.visibility" value={post.visibility} />
        </Badge>
        <span className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink-muted))] ml-auto">
          {formatDate(post.create_time)}
        </span>
        {isAuthor && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            aria-label={t("common.delete") || "Delete"}
            className="text-02 text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-status-error))] transition-colors"
          >
            {t("common.delete") || "Delete"}
          </button>
        )}
      </div>

      <Link href={`/social/${post.id}`} className="block">
        <p className="text-04 text-[hsl(var(--color-ink))] whitespace-pre-wrap">
          {post.content}
        </p>
      </Link>

      <div className="flex items-center gap-4 mt-3 text-02 font-mono tabular-nums text-[hsl(var(--color-ink-muted))]">
        <span className="flex items-center gap-1">
          💬 {post.comment_count}
        </span>
        <span className="flex items-center gap-1">
          ❤️ {post.reaction_count}
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
