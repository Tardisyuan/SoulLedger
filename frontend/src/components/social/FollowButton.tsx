"use client";

import { useToggleFollow, useFollowing } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

export function FollowButton({ userId, className }: { userId: string; className?: string }) {
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

  // The `Button` primitive (规范 v1 §2) rather than hand-written classes: 28 px
  // in a row, and "already following" is the quieter ghost so a column of them
  // does not read as a column of calls to action.
  return (
    <Button
      type="button"
      size="sm"
      variant={isFollowing ? "ghost" : "secondary"}
      onClick={handleClick}
      disabled={toggleFollow.isPending}
      className={className}
    >
      {toggleFollow.isPending
        ? "..."
        : isFollowing
          ? t("social.following") || "Following"
          : t("social.follow") || "Follow"}
    </Button>
  );
}
