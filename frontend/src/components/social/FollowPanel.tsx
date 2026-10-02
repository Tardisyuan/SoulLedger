"use client";

import { useState } from "react";
import Link from "next/link";
import { useFollowing, useFollowers } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { QueryError } from "@/src/components/ui/PageError";
import { FollowButton } from "./FollowButton";
import { Avatar } from "./Avatar";
import { REACTIONS } from "./ReactionBar";

/**
 * 动态页右列(A5):「关注」卡(关注中 · N / 粉丝 · N,每人一行 56 高:32 头像 + 姓名 + 「已关注」)
 * 与表态说明。数据与 /social/follows 同两条查询(`/social/follows/following/`、`…/followers/`),
 * 两个接口都只回一页的裸数组,所以 N 是这一页的条数,与 /social/follows 的标签同一个数。
 */
export function FollowPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"following" | "followers">("following");
  const following = useFollowing();
  const followers = useFollowers();
  const active = tab === "following" ? following : followers;
  const list = active.data ?? [];
  const light = REACTIONS.filter((r) => r.type !== "ETERNAL_LIGHT");

  return (
    <aside className="flex flex-col gap-6">
      <section aria-labelledby="follow-panel" className="flex flex-col gap-2 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-[20px]">
        <h2 id="follow-panel" className="sr-only">{t("social.follows")}</h2>
        <div className="flex border-b border-[oklch(var(--color-line))]">
          {(["following", "followers"] as const).map((key) => {
            const n = (key === "following" ? following : followers).data?.length ?? 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={`${TAB_BASE} ${tab === key ? TAB_ON : TAB_OFF} min-h-(--control-h-sm) px-2`}
              >
                {t(key === "following" ? "social.following" : "social.followers")} ·{" "}
                <span className="font-mono tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
        {active.isError ? (
          <QueryError onRetry={() => void active.refetch()} />
        ) : list.length === 0 && !active.isLoading ? (
          <p className="py-3 text-sm text-[oklch(var(--color-ink-subtle))]">
            {t(tab === "following" ? "social.no_following" : "social.no_followers")}
          </p>
        ) : (
          <ul>
            {list.map((f) => {
              const id = tab === "following" ? f.following : f.follower;
              const name = tab === "following" ? f.following_name : f.follower_name;
              return (
                <li key={f.id} className="flex min-h-14 items-center gap-3">
                  <Avatar name={name} size={32} />
                  <Link href={`/social/profile/${id}`} className="min-w-0 flex-1 truncate text-sm text-[oklch(var(--color-ink))] hover:underline">
                    {name || id}
                  </Link>
                  <FollowButton userId={id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="reaction-legend" className="flex flex-col gap-1">
        <h2 id="reaction-legend" className="text-2xs uppercase tracking-[0.1em] text-[oklch(var(--color-ink-subtle))]">
          {t("social.reactions")}
        </h2>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("social.legend.light", { list: light.map((r) => `${r.glyph} ${t(r.key)}`).join(" · ") })}
        </p>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">◉ {t("social.legend.lamp")}</p>
      </section>
    </aside>
  );
}
