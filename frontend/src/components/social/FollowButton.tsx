"use client";

import { useToggleFollow, useFollowing } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * A5:列表里 44 高次按钮「已关注」/「关注」;个人页(`prominent`)未关注时是 48 高主按钮「＋ 关注」。
 * 「已关注」是次按钮(v3 稿),不再是 v1 的幽灵按钮。
 */
export function FollowButton({ userId, className, prominent = false }: { userId: string; className?: string; prominent?: boolean }) {
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

  const loud = prominent && !isFollowing;
  return (
    <Button
      type="button"
      size={prominent ? "md" : "sm"}
      variant={loud ? "primary" : "secondary"}
      onClick={handleClick}
      disabled={toggleFollow.isPending}
      className={className}
    >
      {toggleFollow.isPending
        ? "..."
        : isFollowing
          ? t("social.following")
          : <>{loud ? <span aria-hidden="true">＋ </span> : null}{t("social.follow")}</>}
    </Button>
  );
}
