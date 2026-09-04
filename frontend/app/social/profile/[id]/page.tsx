"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useProfile, usePosts } from "@soulledger/core/hooks/useSocial";
import { ProfileCard } from "@/src/components/social/ProfileCard";
import { PostCard } from "@/src/components/social/PostCard";
import { Pagination } from "@/src/components/ui/Pagination";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";

export default function UserProfilePage() {
  const { t } = useI18n();
  const params = useParams();
  const userId = params.id as string;
  const [page, setPage] = useState(1);

  const { data: profile, isLoading: profileLoading, error: profileError } = useProfile(userId);
  const { data: postsData, isLoading: postsLoading } = usePosts({ author: userId, page });

  const posts = postsData?.results ?? [];
  const totalPages = postsData ? Math.ceil(postsData.count / PAGE_SIZE) : 0;

  /**
   * Same split as app/social/page.tsx, for the same reason: `Pagination` is
   * imported directly here (no DataTable renders a second bar), and
   * `Pagination.tsx:19` is itself a `flex items-center justify-between`.
   * Dropping the whole component into `controls` would nest that inside
   * PageShell's `shrink-0` half, collapsing it to content width so the record
   * count sits flush against the ← → buttons with the `count` half empty. So:
   * count on the left, `showInfo={false}` component on the right. `-mt-4`
   * cancels Pagination's standalone top margin, which the slot's
   * `border-t-2 pt-3` already supplies.
   */
  const pagination = postsData
    ? {
        count: (
          <p className="text-03 text-[hsl(var(--color-ink-muted))]">
            {t("pagination.info", {
              page: String(page),
              total: String(totalPages),
              count: String(postsData.count),
            })}
          </p>
        ),
        controls: (
          <div className="-mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              count={postsData.count}
              onPageChange={setPage}
              showInfo={false}
            />
          </div>
        ),
      }
    : undefined;

  return (
    <PageShell
      variant="prose"
      title={t("social.profile")}
      backLink={
        <Link
          href="/social"
          className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline"
        >
          ← {t("social.back")}
        </Link>
      }
      pagination={pagination}
    >
      <div className="space-y-6">
        {profileLoading ? (
          <Skeleton className="h-32" />
        ) : profileError ? (
          /* An error is not an empty state — see app/social/[id]/page.tsx.
             `--color-status-error` replaces `text-red-400`, which was a raw
             palette value and went pale in light mode. */
          <p role="alert" className="text-04 text-[hsl(var(--color-status-error))]">
            {String(profileError)}
          </p>
        ) : profile ? (
          <ProfileCard profile={profile} />
        ) : null}

        <h2 className="text-06 text-[hsl(var(--color-ink))]">{t("social.user_posts")}</h2>

        {postsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState title={t("social.posts")} reason={t("social.no_posts")} />
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
