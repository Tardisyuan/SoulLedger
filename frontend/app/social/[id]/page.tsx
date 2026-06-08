"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { usePost } from "@/src/hooks/useSocial";
import { PostCard } from "@/src/components/social/PostCard";
import { CommentThread } from "@/src/components/social/CommentThread";
import { useI18n } from "@/src/contexts/I18nContext";

export default function PostDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const id = params.id as string;
  const { data: post, isLoading, error } = usePost(id);

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <Link
          href="/social"
          className="text-[hsl(var(--color-accent))] hover:underline text-sm"
        >
          ← {t("social.back") || "Back"}
        </Link>
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("social.post_detail") || "Post"}
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="space-y-4">
            <div className="animate-pulse h-40 bg-[hsl(var(--color-surface-1))] rounded-xl" />
            <div className="animate-pulse h-24 bg-[hsl(var(--color-surface-1))] rounded-xl" />
          </div>
        ) : error ? (
          <div className="text-center text-red-400 py-12">
            {String(error)}
          </div>
        ) : !post ? (
          <div className="text-center py-12 text-[hsl(var(--color-ink-subtle))]">
            {t("social.post_not_found") || "Post not found"}
          </div>
        ) : (
          <>
            <PostCard post={post} />

            <div className="mt-6">
              <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] mb-3">
                {t("social.comments") || "Comments"}
              </h2>
              <CommentThread postId={id} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
