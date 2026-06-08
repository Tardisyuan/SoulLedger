"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useProfile, usePosts } from "@/src/hooks/useSocial";
import { ProfileCard } from "@/src/components/social/ProfileCard";
import { PostCard } from "@/src/components/social/PostCard";
import { Pagination } from "@/src/components/ui/Pagination";
import { useI18n } from "@/src/contexts/I18nContext";

export default function UserProfilePage() {
  const { t } = useI18n();
  const params = useParams();
  const userId = params.id as string;
  const [page, setPage] = useState(1);

  const { data: profile, isLoading: profileLoading, error: profileError } = useProfile(userId);
  const { data: postsData, isLoading: postsLoading } = usePosts({ author: userId, page });

  const posts = postsData?.results ?? [];
  const totalPages = postsData ? Math.ceil(postsData.count / 20) : 0;

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
          {t("social.profile") || "Profile"}
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {profileLoading ? (
          <div className="animate-pulse h-32 bg-[hsl(var(--color-surface-1))] rounded-xl" />
        ) : profileError ? (
          <div className="text-center text-red-400 py-12">
            {String(profileError)}
          </div>
        ) : profile ? (
          <ProfileCard profile={profile} />
        ) : null}

        <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))]">
          {t("social.user_posts") || "Posts"}
        </h2>

        {postsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse h-28 bg-[hsl(var(--color-surface-1))] rounded-xl" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-8 text-[hsl(var(--color-ink-subtle))]">
            {t("social.no_posts") || "No posts yet"}
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            count={postsData?.count ?? 0}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
