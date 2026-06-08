"use client";

import { useToggleFollow, useFollowing } from "@/src/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";

export function FollowButton({ userId }: { userId: string }) {
  const { t } = useI18n();
  const toggleFollow = useToggleFollow();
  const { data } = useFollowing();
  const followingList = (data ?? []) as Array<{ following: string }>;

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
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
        isFollowing
          ? "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))]"
          : "bg-[hsl(var(--color-accent))] text-white hover:bg-[hsl(var(--color-accent))]"
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
