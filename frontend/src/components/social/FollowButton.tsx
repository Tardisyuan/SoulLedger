"use client";

import { useToggleFollow, useFollowing } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";

export function FollowButton({ userId }: { userId: string }) {
  const { t } = useI18n();
  const toggleFollow = useToggleFollow();
  const { data } = useFollowing();
  const followingList = data ?? [];

  const isFollowing = followingList.some(
    (f) => String(f.following) === String(userId),
  );

  const handleClick = () => {
    toggleFollow.mutate(userId);
  };

  return (
    <button
      onClick={handleClick}
      disabled={toggleFollow.isPending}
      className={`px-4 py-1.5 text-sm font-medium transition-colors ${
        isFollowing
          ? "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-3))] border border-[oklch(var(--color-hairline))]"
          // Not following: the primary button (规范 v1: ink fill, canvas text).
          : "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))] hover:bg-[oklch(var(--color-ink-muted))]"
      } disabled:opacity-50`}
    >
      {toggleFollow.isPending
        ? "..."
        : isFollowing
          ? t("social.following") || "Following"
          : t("social.follow") || "Follow"}
    </button>
  );
}
