"use client";

import { useState } from "react";
import { useFeed, usePosts, useCreatePost } from "@/src/hooks/useSocial";
import { PostCard } from "@/src/components/social/PostCard";
import { Pagination } from "@/src/components/ui/Pagination";
import { useI18n } from "@/src/contexts/I18nContext";

export default function SocialFeedPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"feed" | "all">("feed");
  const [page, setPage] = useState(1);
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const createPost = useCreatePost();

  const params = { page };
  const { data: feedData, isLoading: feedLoading } = useFeed(
    tab === "feed" ? params : undefined,
  );
  const { data: allData, isLoading: allLoading } = usePosts(
    tab === "all" ? params : undefined,
  );

  const data = tab === "feed" ? feedData : allData;
  const posts = Array.isArray(data) ? data : (data?.results ?? []);
  const isLoading = tab === "feed" ? feedLoading : allLoading;
  const totalPages =
    data && !Array.isArray(data) ? Math.ceil(data.count / 20) : 0;

  const handleCreate = () => {
    if (!content.trim()) return;
    createPost.mutate(
      { content: content.trim(), visibility },
      { onSuccess: () => { setContent(""); setVisibility("PUBLIC"); } },
    );
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("social.title") || "Social"}
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
        {/* Post creation */}
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-xl p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              t("social.placeholder") || "What's on your mind?"
            }
            className="w-full resize-none bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg p-3 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            rows={3}
          />
          <div className="flex items-center justify-between mt-3">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-1.5 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            >
              <option value="PUBLIC">Public</option>
              <option value="TENANT">Tenant Only</option>
              <option value="FOLLOWERS">Followers</option>
              <option value="PRIVATE">Private</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={!content.trim() || createPost.isPending}
              className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              {createPost.isPending ? "..." : (t("social.post") || "Post")}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[hsl(var(--color-hairline))]">
          {(["feed", "all"] as const).map((key) => (
            <button
              key={key}
              onClick={() => { setTab(key); setPage(1); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-[hsl(var(--color-accent))] text-[hsl(var(--color-accent))]"
                  : "border-transparent text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {key === "feed"
                ? (t("social.feed") || "Feed")
                : (t("social.all") || "All Posts")}
            </button>
          ))}
        </div>

        {/* Posts */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse h-32 bg-[hsl(var(--color-surface-1))] rounded-xl" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12 text-[hsl(var(--color-ink-subtle))]">
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
            count={!Array.isArray(data) ? data?.count ?? 0 : 0}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
