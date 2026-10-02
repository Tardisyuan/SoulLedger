"use client";

import { useState } from "react";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useFeed, useMyProfile, usePosts } from "@soulledger/core/hooks/useSocial";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { PostCard } from "@/src/components/social/PostCard";
import { PostComposer } from "@/src/components/social/PostComposer";
import { FollowPanel } from "@/src/components/social/FollowPanel";
import { Modal } from "@/src/components/ui/Modal";
import { Pagination } from "@/src/components/ui/Pagination";
import { useI18n } from "@/src/contexts/I18nContext";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Skeleton } from "@/components/ui/skeleton";

const TAB_KEYS = ["feed", "all"] as const;

export default function SocialFeedPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"feed" | "all">("feed");
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);

  const params = { page };
  // Both queries used to RUN, always. Passing `undefined` params to the
  // inactive one changes its key; it does not stop it fetching — so every
  // visit to this page hit both `/social/feed/` and `/social/posts/`, and
  // every page turn hit both again. `enabled` is what actually gates a query.
  const { data: feedData, isLoading: feedLoading, isPlaceholderData: feedStale, isError: feedError, refetch: refetchFeed } =
    useFeed(params, { enabled: tab === "feed" });
  const { data: allData, isLoading: allLoading, isPlaceholderData: allStale, isError: allError, refetch: refetchAll } =
    usePosts(params, { enabled: tab === "all" });

  // 身份带(A5):题「朋友圈」,右栏「关注 N · 粉丝 N」(自己的资料;没取到就不写)。
  const { data: me } = useMyProfile();
  usePlaque({
    title: t("plaque.social"),
    meta: me ? t("plaque.social_meta", { following: String(me.following_count), followers: String(me.followers_count) }) : undefined,
  });

  const data = tab === "feed" ? feedData : allData;
  const posts = Array.isArray(data) ? data : (data?.results ?? []);
  const isLoading = tab === "feed" ? feedLoading : allLoading;
  /* `usePosts` / `useFeed` both set `placeholderData`, which keeps the
     previous page rendered and pins `isLoading` to false from then on — so the
     skeleton branch below never runs again and a page turn moved nothing. */
  const isStale = tab === "feed" ? feedStale : allStale;
  // Neither error was read. A failed feed produced `data === undefined`, which
  // falls through to `?? []`, which renders "no posts yet" — the same words a
  // genuinely empty feed shows. The active tab's error is the one on screen.
  const isError = tab === "feed" ? feedError : allError;
  const refetch = tab === "feed" ? refetchFeed : refetchAll;
  const paged = data && !Array.isArray(data) ? data : null;
  const totalPages = paged ? Math.ceil(paged.count / PAGE_SIZE) : 0;

  /**
   * The `pagination` slot is filled directly here rather than left to a
   * DataTable: this list renders <PostCard>s, so `Pagination` is imported on
   * its own and there is no second pagination bar to collide with
   * (PageShell.tsx:90).
   *
   * SPLIT, not whole. `Pagination.tsx:19` is a self-contained
   * `flex items-center justify-between`, and PageShell's slot is already that
   * same two-ended row — dropping the whole component into `controls` would
   * nest a justify-between inside a `shrink-0` box, which collapses to content
   * width and parks the record count hard against the ← → buttons while the
   * `count` half sits empty. So the count is written on the left (the same
   * `pagination.info` string the component would have rendered) and the
   * component goes on the right with `showInfo={false}`. The `-mt-4` cancels
   * Pagination's own standalone `mt-4`, which the slot's `border-t-2 pt-3`
   * already provides.
   *
   * The object is passed whenever the response is paginated at all, even on a
   * single page, so the rule line does not appear and disappear between pages.
   */
  const pagination = paged
    ? {
        count: (
          <p className="text-sm text-[oklch(var(--color-ink-muted))]">
            {t("pagination.info", {
              page: String(page),
              total: String(totalPages),
              count: String(paged.count),
            })}
          </p>
        ),
        controls: (
          <div className="-mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              count={paged.count}
              onPageChange={setPage}
              showInfo={false}
            />
          </div>
        ),
      }
    : undefined;

  /* A5:标签行在左列里(48 高、下边 1px line);393 两等分、surface-1。48 写成 `h-`,不是
     `min-h-`:TAB_BASE 自带 `min-h-(--control-h-sm)`(44),两个 min-h 谁赢取决于生成 CSS 的顺序。
     `aria-pressed`, not `role="tab"`: these own no tabpanel and arrow keys do
     not move between them — a set of toggles with exactly one on.
     `components/ui/data-grid/FilterBar.tsx:181` already does this. */
  const tabs = (
    <div className="flex gap-6 border-b border-[oklch(var(--color-line))] max-[768px]:gap-0 max-[768px]:bg-[oklch(var(--color-surface-1))]">
      {TAB_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => { setTab(key); setPage(1); }}
          aria-pressed={tab === key}
          className={`${TAB_BASE} ${tab === key ? TAB_ON : TAB_OFF} h-(--control-h-md) px-0 max-[768px]:flex-1`}
        >
          {key === "feed" ? t("social.feed") : t("social.all")}
        </button>
      ))}
    </div>
  );

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("social.title")}
          <MenuGloss path="/social" />
        </>
      }
      pagination={pagination}
    >
      {/* 1440:`minmax(0,680px) 300px`、间距 32、整体居中;≤ 1023 右列落到下面。 */}
      <div className="mx-auto grid max-w-[1012px] gap-8 lg:grid-cols-[minmax(0,680px)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {tabs}

          {/* 393 下发帖框不在页面里 —— 由右下的「＋ 发帖」打开。 */}
          <div className="border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4 max-[768px]:hidden">
            <PostComposer />
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : isError ? (
            <QueryError onRetry={() => refetch()} />
          ) : posts.length === 0 ? (
            <EmptyState
              title={t("social.posts")}
              reason={t("social.no_posts")}
            />
          ) : (
            <div
              aria-busy={isStale || undefined}
              className={`space-y-3 transition-opacity duration-settle max-[768px]:-mx-4 max-[768px]:space-y-0 ${
                isStale ? "opacity-50 ease-exit" : "opacity-100 ease-enter"
              }`}
            >
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>

        <FollowPanel />
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        onClick={() => setComposing(true)}
        className="fixed right-4 bottom-[calc(var(--bottom-bar)+16px)] z-filters px-[22px] shadow-raised min-[769px]:hidden"
      >
        <span aria-hidden="true">＋ </span>
        {t("social.compose")}
      </Button>
      <Modal isOpen={composing} onClose={() => setComposing(false)} title={t("social.compose")}>
        <PostComposer onPosted={() => setComposing(false)} />
      </Modal>
    </PageShell>
  );
}
