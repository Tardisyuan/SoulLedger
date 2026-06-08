"use client";

import { useState } from "react";
import Link from "next/link";
import { useFollowing, useFollowers } from "@/src/hooks/useSocial";
import { FollowButton } from "@/src/components/social/FollowButton";
import { useI18n } from "@/src/contexts/I18nContext";
import type { Follow } from "@/lib/api";

export default function FollowsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"following" | "followers">("following");
  const { data: followingData, isLoading: followingLoading } = useFollowing();
  const { data: followersData, isLoading: followersLoading } = useFollowers();

  const followingList = (followingData ?? []) as Follow[];
  const followersList = (followersData ?? []) as Follow[];
  const isLoading = tab === "following" ? followingLoading : followersLoading;
  const list = tab === "following" ? followingList : followersList;

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
          {t("social.follows") || "Follows"}
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-[hsl(var(--color-hairline))]">
          {(["following", "followers"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-[hsl(var(--color-accent))] text-[hsl(var(--color-accent))]"
                  : "border-transparent text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {key === "following"
                ? (t("social.following") || "Following")
                : (t("social.followers") || "Followers")}
              {` (${key === "following" ? followingList.length : followersList.length})`}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse h-14 bg-[hsl(var(--color-surface-1))] rounded-lg" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-12 text-[hsl(var(--color-ink-subtle))]">
            {tab === "following"
              ? (t("social.no_following") || "Not following anyone yet")
              : (t("social.no_followers") || "No followers yet")}
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((item) => {
              const isFollowingTab = tab === "following";
              const userId = isFollowingTab ? item.following : item.follower;
              const userName = isFollowingTab
                ? item.following_name
                : item.follower_name;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-[hsl(var(--color-surface-2))] flex items-center justify-center text-sm font-bold text-[hsl(var(--color-accent))] flex-shrink-0">
                    {userName?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  <Link
                    href={`/social/profile/${userId}`}
                    className="font-medium text-[hsl(var(--color-ink))] hover:underline flex-1"
                  >
                    {userName || userId}
                  </Link>
                  <FollowButton userId={userId} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
