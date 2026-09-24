"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Button } from "@/src/components/ui/Button";
import { FollowButton } from "./FollowButton";
import { ProfileEditModal } from "./ProfileEditModal";
import type { UserProfile } from "@soulledger/core/api";

/**
 * 身份段 —— 页面的主语。规范 v1 详情页原型:卡片撤掉(无底色、无阴影、无框),
 * 头像是全站唯一保留圆角的东西;三个计数是账行,数字等宽右对齐。
 *
 * 这里曾是一张 `p-6` 的身份卡,注释论证过它为什么不收成 `p-4`。卡没了,那段
 * 论证也就没有对象了 —— 页面上只剩行线与区块标。
 */
export function ProfileCard({ profile }: { profile: UserProfile }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const isOwnProfile = user && String(user.id) === String(profile.user);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const counts: [number, string][] = [
    [profile.post_count, t("social.posts") || "posts"],
    [profile.followers_count, t("social.followers") || "followers"],
    [profile.following_count, t("social.following_count") || "following"],
  ];

  return (
    <section>
      <div className="flex items-center gap-4 pb-3 border-b border-[oklch(var(--color-block))]">
        <div className="w-16 h-16 rounded-full bg-[oklch(var(--color-surface-2))] flex items-center justify-center text-md text-[oklch(var(--color-accent-ink))] overflow-hidden shrink-0">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt={profile.username}
              className="w-full h-full object-cover"
            />
          ) : (
            profile.username.charAt(0).toUpperCase()
          )}
        </div>
        <h2 className="flex-1 min-w-0 text-md text-[oklch(var(--color-ink))] truncate" title={profile.username}>
          {profile.username}
        </h2>
        {isOwnProfile ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditOpen(true)}>
            {t("social.edit_profile") || "Edit profile"}
          </Button>
        ) : (
          <FollowButton userId={profile.user} />
        )}
      </div>

      {profile.bio && (
        <p className="py-2 max-w-[72ch] text-sm text-[oklch(var(--color-ink-muted))] whitespace-pre-wrap border-b border-[oklch(var(--color-rule))]">
          {profile.bio}
        </p>
      )}

      <dl className="grid grid-cols-[1fr_auto] max-w-sm text-sm">
        {counts.map(([n, label]) => (
          <div key={label} className="contents">
            <dt className="py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))]">{label}</dt>
            <dd className="py-1.5 border-b border-[oklch(var(--color-rule))] text-right font-mono tabular-nums text-[oklch(var(--color-ink))]">{n}</dd>
          </div>
        ))}
      </dl>

      <div className="pt-2">
        <Link
          href={`/social/profile/${profile.user}`}
          className="text-sm text-[oklch(var(--color-accent-ink))] hover:underline"
        >
          {t("social.view_all_posts") || "View all posts"} →
        </Link>
      </div>

      {isOwnProfile && (
        <ProfileEditModal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          profile={profile}
        />
      )}
    </section>
  );
}
