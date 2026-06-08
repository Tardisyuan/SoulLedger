"use client";

import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { FollowButton } from "./FollowButton";
import type { UserProfile } from "@/lib/api";

export function ProfileCard({ profile }: { profile: UserProfile }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const isOwnProfile = user && String(user.id) === String(profile.user);

  return (
    <div className="bg-[hsl(var(--color-surface))] border border-[hsl(var(--color-hairline))] rounded-xl p-6">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-16 h-16 rounded-full bg-[hsl(var(--color-surface-2))] flex items-center justify-center text-xl font-bold text-[hsl(var(--color-accent))] overflow-hidden flex-shrink-0">
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
            <h2 className="text-lg font-bold text-[hsl(var(--color-ink))] truncate">
              {profile.username}
            </h2>
            {!isOwnProfile && (
              <FollowButton userId={profile.user} />
            )}
          </div>
          {profile.bio && (
            <p className="text-sm text-[hsl(var(--color-ink-muted))] mt-1 whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}
          <div className="flex gap-4 mt-3 text-sm">
            <span className="text-[hsl(var(--color-ink-muted))]">
              <strong className="text-[hsl(var(--color-ink))]">{profile.post_count}</strong>{" "}
              {t("social.posts") || "posts"}
            </span>
            <span className="text-[hsl(var(--color-ink-muted))]">
              <strong className="text-[hsl(var(--color-ink))]">{profile.followers_count}</strong>{" "}
              {t("social.followers") || "followers"}
            </span>
            <span className="text-[hsl(var(--color-ink-muted))]">
              <strong className="text-[hsl(var(--color-ink))]">{profile.following_count}</strong>{" "}
              {t("social.following_count") || "following"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[hsl(var(--color-hairline))]/50">
        <Link
          href={`/social/profile/${profile.user}`}
          className="text-sm text-[hsl(var(--color-accent))] hover:underline"
        >
          {t("social.view_all_posts") || "View all posts"} →
        </Link>
      </div>
    </div>
  );
}
