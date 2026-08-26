"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useDeletePost } from "@/src/hooks/useSocial";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { ReactionBar } from "./ReactionBar";
import type { Post } from "@/lib/api";
import { DomainEnum } from "@/src/components/ui/DomainValue";

const VISIBILITY_COLORS: Record<string, string> = {
  PUBLIC: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  TENANT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  FOLLOWERS:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  PRIVATE:
    "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
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
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <Link
          href={`/social/profile/${post.author}`}
          className="text-04 font-medium text-[hsl(var(--color-ink))] hover:underline"
        >
          {post.author_name || post.author_username}
        </Link>
        <span
          className={`text-02 px-2 py-0.5 rounded-full ${VISIBILITY_COLORS[post.visibility] ?? ""}`}
        >
          <DomainEnum namespace="social.visibility" value={post.visibility} />
        </span>
        <span className="text-02 font-mono tabular-nums text-[hsl(var(--color-ink-muted))] ml-auto">
          {formatDate(post.create_time)}
        </span>
        {isAuthor && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            aria-label={t("common.delete") || "Delete"}
            className="text-02 text-[hsl(var(--color-ink-subtle))] hover:text-red-500 transition-colors"
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
