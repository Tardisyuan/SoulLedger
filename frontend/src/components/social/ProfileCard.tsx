"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { FollowButton } from "./FollowButton";
import { ProfileEditModal } from "./ProfileEditModal";
import type { UserProfile } from "@soulledger/core/api";

/**
 * 身份卡 —— 页面的主语,不是页面上的一块面板。
 *
 * **`p-6` 是有意留下的,不要收敛成 `p-4`。** 全站同一个配方(surface-1 底 +
 * hairline 边)2026-09-10 实测是 **53 处 `p-4` 对 2 处 `p-6`**,而剩下的两处
 * `p-6` 恰好是同一类东西:这里,和 `app/(auth)/login/page.tsx:108` 那张登录卡。
 * 一次审计只看数字会把 2 报成漂移 —— 2aa8494 那一轮就是这么把
 * `dispatch/[id]` 的三处 p-6 收掉的,那三处收得对(它们是并排的详情面板,
 * 内边距要和邻居一致)。这一处不同,理由是结构上的:
 *
 *   - 卡里第一件东西是 **64px 的头像**(`w-16 h-16`)。面板的内边距要贴合文本
 *     行高;身份卡的内边距要贴合那个头像的视觉重量,24px 是它的下限,16px 会
 *     让头像顶到边上。
 *   - 它在 `app/social/profile/[id]/page.tsx:102` 是**整页唯一的一张卡**,
 *     底下跟的是帖子列表,没有并排的兄弟面板可以和它对齐内边距。登录卡同理。
 *
 * 所以判据不是「p-6 还是 p-4」,是「这块东西有没有需要对齐内边距的邻居」。
 * 没有邻居 + 有一个大头像 = 身份卡 = `p-6`。写在这里是因为上一轮就是这么判的,
 * 但**没写下来**,于是下一轮审计只会重新数一遍 53 比 2 再报一次。
 */
export function ProfileCard({ profile }: { profile: UserProfile }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const isOwnProfile = user && String(user.id) === String(profile.user);
  const [isEditOpen, setIsEditOpen] = useState(false);

  return (
    <div className="bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-hairline))] p-6">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-16 h-16 rounded-full bg-[oklch(var(--color-surface-2))] flex items-center justify-center text-06 text-[oklch(var(--color-accent-ink))] overflow-hidden shrink-0">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.username}
              className="w-full h-full object-cover"
            />
          ) : (
            profile.username.charAt(0).toUpperCase()
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-06 text-[oklch(var(--color-ink))] truncate">
              {profile.username}
            </h2>
            {isOwnProfile ? (
              <button
                type="button"
                onClick={() => setIsEditOpen(true)}
                className="px-4 py-1.5 text-03 font-medium border border-[oklch(var(--color-hairline))] text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))] transition-colors"
              >
                {t("social.edit_profile") || "Edit profile"}
              </button>
            ) : (
              <FollowButton userId={profile.user} />
            )}
          </div>
          {profile.bio && (
            <p className="text-04 text-[oklch(var(--color-ink-muted))] mt-1 whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}
          <div className="flex gap-4 mt-3 text-02">
            <span className="text-[oklch(var(--color-ink-muted))]">
              <strong className="font-mono tabular-nums text-[oklch(var(--color-ink))]">{profile.post_count}</strong>{" "}
              {t("social.posts") || "posts"}
            </span>
            <span className="text-[oklch(var(--color-ink-muted))]">
              <strong className="font-mono tabular-nums text-[oklch(var(--color-ink))]">{profile.followers_count}</strong>{" "}
              {t("social.followers") || "followers"}
            </span>
            <span className="text-[oklch(var(--color-ink-muted))]">
              <strong className="font-mono tabular-nums text-[oklch(var(--color-ink))]">{profile.following_count}</strong>{" "}
              {t("social.following_count") || "following"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[oklch(var(--color-hairline))]/50">
        <Link
          href={`/social/profile/${profile.user}`}
          className="text-03 text-[oklch(var(--color-accent-ink))] hover:underline"
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
    </div>
  );
}
