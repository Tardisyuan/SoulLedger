"use client";

import { useState } from "react";
import Link from "next/link";
import { useFollowing, useFollowers } from "@soulledger/core/hooks/useSocial";
import { FollowButton } from "@/src/components/social/FollowButton";
import { useI18n } from "@/src/contexts/I18nContext";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";

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
          className="text-sm text-[oklch(var(--color-accent-ink))] hover:underline"
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
          className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
            tab === key
              ? "border-[oklch(var(--color-accent))] text-[oklch(var(--color-accent-ink))]"
              : "border-transparent text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
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
      {!isError && !isLoading && list.length === 0 ? (
        <EmptyState
          title={tab === "following" ? t("social.following") : t("social.followers")}
          reason={
            tab === "following" ? t("social.no_following") : t("social.no_followers")
          }
        />
      ) : (
        /* 账页表格(规范 v1 §2):整行点进 /social/profile/[id];关注按钮抬到行链接的
           `::after` 覆盖层之上(`relative z-[1]`),所以点按钮是关注、点行别处是进主页。
           加载与失败交给 DataTable(失败行是「! 加载失败」+ 重试,不会落到「还没有关注」);
           空仍是上面那支 EmptyState,因为它按页签说两种不同的空。 */
        <DataTable<(typeof list)[number]>
          linkedRows
          density="compact"
          caption={tab === "following" ? t("social.following") : t("social.followers")}
          columns={[
            { key: "name", header: tab === "following" ? t("social.following") : t("social.followers") },
            { key: "actions", header: t("common.row_actions"), align: "right", srOnlyHeader: true },
          ]}
          data={list}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          keyExtractor={(item) => String(item.id)}
          renderRow={(item) => {
            const isFollowingTab = tab === "following";
            const userId = isFollowingTab ? item.following : item.follower;
            const userName = isFollowingTab ? item.following_name : item.follower_name;
            return (
              <>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-3">
                    {/* rounded-full stays: an avatar is an identity mark, one of
                        the two shapes the radius scale still has a value for. */}
                    <span
                      aria-hidden="true"
                      className="w-7 h-7 rounded-full border border-[oklch(var(--color-line))] flex items-center justify-center text-xs font-medium text-[oklch(var(--color-ink-muted))] shrink-0"
                    >
                      {userName?.charAt(0)?.toUpperCase() || "?"}
                    </span>
                    <Link
                      href={`/social/profile/${userId}`}
                      className={`font-medium text-[oklch(var(--color-ink))] ${ROW_LINK}`}
                    >
                      {userName || userId}
                    </Link>
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <FollowButton userId={userId} className="relative z-[1]" />
                </td>
              </>
            );
          }}
        />
      )}
    </PageShell>
  );
}
