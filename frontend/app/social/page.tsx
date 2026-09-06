"use client";

import { useState } from "react";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useFeed, usePosts, useCreatePost } from "@soulledger/core/hooks/useSocial";
import { PostCard } from "@/src/components/social/PostCard";
import { Pagination } from "@/src/components/ui/Pagination";
import { useI18n } from "@/src/contexts/I18nContext";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { TextAreaField, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const TAB_KEYS = ["feed", "all"] as const;

export default function SocialFeedPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"feed" | "all">("feed");
  const [page, setPage] = useState(1);
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const createPost = useCreatePost();

  const params = { page };
  // Both queries used to RUN, always. Passing `undefined` params to the
  // inactive one changes its key; it does not stop it fetching — so every
  // visit to this page hit both `/social/feed/` and `/social/posts/`, and
  // every page turn hit both again. `enabled` is what actually gates a query.
  const { data: feedData, isLoading: feedLoading, isPlaceholderData: feedStale, isError: feedError, refetch: refetchFeed } =
    useFeed(params, { enabled: tab === "feed" });
  const { data: allData, isLoading: allLoading, isPlaceholderData: allStale, isError: allError, refetch: refetchAll } =
    usePosts(params, { enabled: tab === "all" });

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

  const handleCreate = () => {
    if (!content.trim()) return;
    createPost.mutate(
      { content: content.trim(), visibility },
      { onSuccess: () => { setContent(""); setVisibility("PUBLIC"); } },
    );
  };

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
          <p className="text-03 text-[hsl(var(--color-ink-muted))]">
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

  return (
    <PageShell
      variant="prose"
      title={
        <>
          {t("social.title")}
          <MenuGloss path="/social" />
        </>
      }
      tabs={TAB_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => { setTab(key); setPage(1); }}
          // `aria-pressed`, not `role="tab"`. These are not a real tablist —
          // they do not own a `tabpanel`, arrow keys do not move between them,
          // and claiming the role without that contract is the defect this
          // repo already has three instances of. What they ARE is a set of
          // toggles where exactly one is on, and `aria-pressed` says that
          // truthfully. Before this the selected one differed only by border
          // and text COLOUR, so a screen-reader user heard two identical
          // buttons and could not tell which view was showing.
          // `components/ui/data-grid/FilterBar.tsx:181` already does this.
          aria-pressed={tab === key}
          className={`px-3 py-2 -mb-px text-03 font-medium border-b-2 transition-colors ${
            tab === key
              ? "border-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-ink))]"
              : "border-transparent text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          {key === "feed" ? t("social.feed") : t("social.all")}
        </button>
      ))}
      pagination={pagination}
    >
      <div className="space-y-4">
        {/* Post creation */}
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
          <TextAreaField
            label={t("social.post")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("social.placeholder")}
            rows={3}
          />
          <div className="flex items-center justify-between mt-3">
            {/* Bare <select> rather than <SelectField>: this control sits in a
                row beside the submit button, and SelectField stacks its label
                above the control. It also has no label to stack — the bundles
                carry no `social.visibility` namespace at all (grep: zero hits
                in all three), which is the same gap that makes PostCard's
                visibility badge render as "unrecorded". Reported to main; not
                fixable here without adding keys to three bundles. */}
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              /* `w-auto` undoes fieldControl's `w-full`: a full-width control
                 in this justify-between row would eat every pixel the Post
                 button is not using. */
              className={cn(fieldControl({ size: "sm" }), "w-auto")}
              aria-label={t("social.visibility_label")}
            >
              {/* Was four hardcoded English strings. `social.visibility.*` did
                  not exist in any of the three bundles, which also meant
                  PostCard's `<DomainEnum namespace="social.visibility">` had
                  nothing to resolve and every post's badge rendered as
                  MissingValue — in production, not only under the test stub.
                  The keys exist now, so the same four labels serve both the
                  control that sets the value and the badge that displays it. */}
              {(["PUBLIC", "TENANT", "FOLLOWERS", "PRIVATE"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`social.visibility.${v}`)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="primary"
              onClick={handleCreate}
              disabled={!content.trim()}
              loading={createPost.isPending}
            >
              {t("social.post")}
            </Button>
          </div>
        </div>

        {/* Posts */}
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
            className={`space-y-3 transition-opacity duration-settle ${
              isStale ? "opacity-50 ease-exit" : "opacity-100 ease-enter"
            }`}
          >
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
