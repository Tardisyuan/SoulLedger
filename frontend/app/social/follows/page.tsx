"use client";

import { useState } from "react";
import Link from "next/link";
import { useFollowing, useFollowers } from "@soulledger/core/hooks/useSocial";
import { FollowButton } from "@/src/components/social/FollowButton";
import { useI18n } from "@/src/contexts/I18nContext";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Skeleton } from "@/components/ui/skeleton";

const TAB_KEYS = ["following", "followers"] as const;

export default function FollowsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"following" | "followers">("following");
  const {
    data: followingData,
    isLoading: followingLoading,
    isError: followingError,
    refetch: refetchFollowing,
  } = useFollowing();
  const {
    data: followersData,
    isLoading: followersLoading,
    isError: followersError,
    refetch: refetchFollowers,
  } = useFollowers();

  const followingList = followingData ?? [];
  const followersList = followersData ?? [];
  const isLoading = tab === "following" ? followingLoading : followersLoading;
  const isError = tab === "following" ? followingError : followersError;
  const refetch = tab === "following" ? refetchFollowing : refetchFollowers;
  const list = tab === "following" ? followingList : followersList;

  return (
    <PageShell
      variant="prose"
      title={
        <>
          {t("social.follows")}
          <MenuGloss path="/social/follows" />
        </>
      }
      backLink={
        <Link
          href="/social"
          className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline"
        >
          ← {t("social.back")}
        </Link>
      }
      tabs={TAB_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          // `aria-pressed`, not `role="tab"`. These are not a real tablist —
          // they do not own a `tabpanel`, arrow keys do not move between them,
          // and claiming the role without that contract is the defect this
          // repo already has three instances of. What they ARE is a set of
          // toggles where exactly one is on, and `aria-pressed` says that
          // truthfully. Before this the selected one differed only by border
          // and text COLOUR, so a screen-reader user heard two identical
          // buttons and could not tell which view was showing.
          // `components/ui/data-grid/FilterBar.tsx:181` already does this.
          aria-pressed={tab === key}
          className={`px-3 py-2 -mb-px text-03 font-medium border-b-2 transition-colors ${
            tab === key
              ? "border-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-ink))]"
              : "border-transparent text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          {key === "following" ? t("social.following") : t("social.followers")}
          {` (${key === "following" ? followingList.length : followersList.length})`}
        </button>
      ))}
    >
      {/* A failed request fell through to `list.length === 0` and rendered
          "you follow nobody" -- which is a claim about the world, not about
          the request. */}
      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title={tab === "following" ? t("social.following") : t("social.followers")}
          reason={
            tab === "following" ? t("social.no_following") : t("social.no_followers")
          }
        />
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
                className="flex items-center gap-3 p-3 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] transition-colors"
              >
                {/* rounded-full stays: an avatar is an identity mark, one of
                    the two shapes the radius scale still has a value for. */}
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--color-surface-2))] flex items-center justify-center text-03 font-bold text-[hsl(var(--color-accent-ink))] shrink-0">
                  {userName?.charAt(0)?.toUpperCase() || "?"}
                </div>
                <Link
                  href={`/social/profile/${userId}`}
                  className="text-04 font-medium text-[hsl(var(--color-ink))] hover:underline flex-1"
                >
                  {userName || userId}
                </Link>
                <FollowButton userId={userId} />
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
