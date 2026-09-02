"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { usePost } from "@/src/hooks/useSocial";
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
      variant="prose"
      title={t("social.post_detail")}
      backLink={
        <Link
          href="/social"
          className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline"
        >
          ← {t("social.back")}
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
        <p role="alert" className="text-04 text-[hsl(var(--color-status-error))]">
          {String(error)}
        </p>
      ) : !post ? (
        <EmptyState title={t("social.post")} reason={t("social.post_not_found")} />
      ) : (
        <>
          <PostCard post={post} />

          <div className="mt-6">
            <h2 className="text-06 text-[hsl(var(--color-ink))] mb-3">{t("social.comments")}</h2>
            <CommentThread postId={id} />
          </div>
        </>
      )}
    </PageShell>
  );
}
