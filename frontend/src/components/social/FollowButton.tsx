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
      className={`px-4 py-1.5 text-03 font-medium transition-colors ${
        isFollowing
          ? "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-3))] border border-[oklch(var(--color-hairline))]"
          // `text-black`, not `text-white`. Accent is one colour in both themes
          // (`oklch(0.770351 0.164635 70.6613)`, written `hsl(38 92% 50%)`
          // before the token migration); white on it is about 2.1:1. Button.tsx's docstring settled
          // this for 47-vs-16 call sites — "primary is text-black" — and this
          // one was among the 16.
          : "bg-[oklch(var(--color-accent))] text-black hover:bg-[oklch(var(--color-accent-hover))]"
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
