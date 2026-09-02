"use client";

import { useToggleFollow, useFollowing } from "@/src/hooks/useSocial";
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
      className={`px-4 py-1.5 text-03 font-medium transition-colors ${
        isFollowing
          ? "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))]"
          // `text-black`, not `text-white`. Accent is `hsl(38 92% 50%)` in both
          // themes; white on it is about 2.1:1. Button.tsx's docstring settled
          // this for 47-vs-16 call sites — "primary is text-black" — and this
          // one was among the 16.
          : "bg-[hsl(var(--color-accent))] text-black hover:bg-[hsl(var(--color-accent-hover))]"
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
