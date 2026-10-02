"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { usePost } from "@soulledger/core/hooks/useSocial";
import { PostCard } from "@/src/components/social/PostCard";
import { CommentThread } from "@/src/components/social/CommentThread";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";

export default function PostDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const id = params.id as string;
  const { data: post, isLoading, error } = usePost(id);

  return (
    <PageShell
      variant="page"
      title={t("social.post_detail")}
      backLink={
        <Link
          href="/social"
          className="inline-flex min-h-(--control-h-md) items-center text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] hover:underline"
        >
          ← {t("social.back_to_feed")}
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
        </div>
      ) : error ? (
        /* Not an EmptyState. "This request failed" and "there is nothing
           here" are different facts, and the empty state says the second
           one — so a fetch failure would read as a post that does not
           exist. `--color-status-error` replaces the `text-red-400` that
           went dead in light mode. */
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">✕ </span>
          {String(error)}
        </p>
      ) : !post ? (
        <EmptyState title={t("social.post")} reason={t("social.post_not_found")} />
      ) : (
        /* A5 详情:帖子卡 + 评论区卡,左列宽 680(与动态页同一列)。 */
        <div className="mx-auto flex max-w-[680px] flex-col gap-4 max-[768px]:-mx-4">
          <PostCard post={post} />
          <CommentThread postId={id} count={post.comment_count} />
        </div>
      )}
    </PageShell>
  );
}
