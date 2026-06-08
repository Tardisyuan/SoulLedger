"use client";

import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { ReactionBar } from "./ReactionBar";
import type { Post } from "@/lib/api";

const VISIBILITY_COLORS: Record<string, string> = {
  PUBLIC: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  TENANT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  FOLLOWERS:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  PRIVATE:
    "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export function PostCard({ post }: { post: Post }) {
  const { t } = useI18n();

  return (
    <div className="bg-[hsl(var(--color-surface))] border border-[hsl(var(--color-hairline))] rounded-xl p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <Link
          href={`/social/profile/${post.author}`}
          className="font-medium text-[hsl(var(--color-ink))] hover:underline"
        >
          {post.author_name || post.author_username}
        </Link>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${VISIBILITY_COLORS[post.visibility] ?? ""}`}
        >
          {t(`social.visibility.${post.visibility}`) || post.visibility}
        </span>
        <span className="text-xs text-[hsl(var(--color-ink-muted))] ml-auto">
          {new Date(post.create_time).toLocaleDateString()}
        </span>
      </div>

      <Link href={`/social/${post.id}`} className="block">
        <p className="text-[hsl(var(--color-ink))] whitespace-pre-wrap">
          {post.content}
        </p>
      </Link>

      <div className="flex items-center gap-4 mt-3 text-sm text-[hsl(var(--color-ink-muted))]">
        <span className="flex items-center gap-1">
          💬 {post.comment_count}
        </span>
        <span className="flex items-center gap-1">
          ❤️ {post.reaction_count}
        </span>
      </div>

      <ReactionBar postId={post.id} />
    </div>
  );
}
