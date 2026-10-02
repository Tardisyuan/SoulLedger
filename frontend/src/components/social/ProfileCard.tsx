"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Button } from "@/src/components/ui/Button";
import { FollowButton } from "./FollowButton";
import { ProfileEditModal } from "./ProfileEditModal";
import { Avatar } from "./Avatar";
import type { UserProfile } from "@soulledger/core/api";

/**
 * 个人页资料卡(A5):surface-1、padding 24、间距 20。72 圆头像(上传的头像,否则首字,标题字体 28/600);
 * 右侧标题字体 28/36/600 的名字、15/24 ink-muted 简介、计数行(等宽 600 数字 + 标签,间距 24);
 * 右端 48 高主按钮「＋ 关注」,自己的页面是「编辑资料」。
 *
 * 名字是 `username`:`UserProfileSerializer` 没有显示名字段。v1 的「查看全部帖子」链接撤了 ——
 * 这张卡只出现在个人页上,那个链接指向的就是这一页。
 */
export function ProfileCard({ profile }: { profile: UserProfile }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const isOwnProfile = user && String(user.id) === String(profile.user);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const counts: [number, string][] = [
    [profile.post_count, t("social.posts")],
    [profile.followers_count, t("social.followers")],
    [profile.following_count, t("social.following_count")],
  ];

  return (
    <section className="flex items-start gap-[20px] border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-6 max-[768px]:flex-wrap max-[768px]:border-x-0 max-[768px]:p-4">
      {profile.avatar ? (
        <img
          src={profile.avatar}
          alt={profile.username}
          className="size-18 shrink-0 rounded-full object-cover"
        />
      ) : (
        <Avatar name={profile.username} size={72} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="truncate font-title text-xl font-semibold text-[oklch(var(--color-ink))]" title={profile.username}>
          {profile.username}
        </h2>
        {profile.bio && (
          <p className="whitespace-pre-wrap text-md text-[oklch(var(--color-ink-muted))]">{profile.bio}</p>
        )}
        <dl className="flex flex-wrap gap-6 text-sm">
          {counts.map(([n, label]) => (
            // dt 在前(dl 的语义),画面上数字在前:flex-row-reverse。
            <div key={label} className="flex flex-row-reverse items-baseline justify-end gap-[6px]">
              <dt className="text-[oklch(var(--color-ink-muted))]">{label}</dt>
              <dd className="font-mono font-semibold tabular-nums text-[oklch(var(--color-ink))]">{n}</dd>
            </div>
          ))}
        </dl>
      </div>
      {isOwnProfile ? (
        <Button type="button" variant="primary" onClick={() => setIsEditOpen(true)}>
          {t("social.edit_profile")}
        </Button>
      ) : (
        <FollowButton userId={profile.user} prominent />
      )}

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
