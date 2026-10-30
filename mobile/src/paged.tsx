/**
 * Paging and refusal toasts the circle screens share (cq-apps 2026-10-30 #4): they lived in
 * `screens/circle.tsx`, so `circlePeople` / `circleInbox` imported the feed screen for them.
 * A leaf -- it reaches no screen. Not merged with the officer app's `useMoreRows` (a different
 * contract: that one is handed pages, this one reads them).
 */
import { soulErrorCode, soulErrorMessage } from "@soulledger/core/api/soul";
import { soulSocialApi, type SoulPost } from "@soulledger/core/api/soul-social";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useToast } from "./feedback";
import { useI18n } from "./i18n";
import { Skeleton, SmallButton, useLayout } from "./ui";

/** A refusal as copy: the circle's own codes first, then the app's shared table. */
const REFUSALS: Record<string, string> = {
  muted: "soul_app.circle.muted.body",
  eternal_light_locked: "soul_app.circle.react.lamp_locked",
  post_sealed: "soul_app.circle.profile.reborn_body",
  report_limit: "soul_app.circle.report.limit",
  // 图片(apps/social/media.py)。media_not_found:传好的图过了清理时限、已被清掉。
  not_an_image: "soul_app.circle.media.errors.not_an_image",
  too_large: "soul_app.circle.media.errors.too_large",
  too_many_pixels: "soul_app.circle.media.errors.too_many_pixels",
  too_many_pending: "soul_app.circle.media.errors.too_many_pending",
  too_many_media: "soul_app.circle.media.limit",
  media_not_found: "soul_app.circle.media.expired",
};

export function useFailure() {
  const { t } = useI18n();
  const toast = useToast();
  return (e: unknown) => {
    const code = soulErrorCode(e);
    if (code && code in REFUSALS) return toast(t(REFUSALS[code]), "failure");
    const m = soulErrorMessage(e);
    toast(t(m.key, m.params), "failure");
  };
}

export function useFailure() {
  const { t } = useI18n();
  const toast = useToast();
  return (e: unknown) => {
    const code = soulErrorCode(e);
    if (code && code in REFUSALS) return toast(t(REFUSALS[code]), "failure");
    const m = soulErrorMessage(e);
    toast(t(m.key, m.params), "failure");
  };
}

type Page<T> = { results: T[]; next?: string | null };

/**
 * A list read a page at a time: the feed, one soul's posts, one post's comments.
 * What is held is tagged with the query it answers, so a switch shows nothing
 * stale; a late answer (another query, or overtaken by a newer request) is
 * dropped; a row already held is not added twice (the list moved under the
 * pages between two requests). `reload` re-reads every page held so far, so a
 * refresh does not fold the list back to its first page. `more` does nothing
 * while any read is in flight or once the last page is held — a list's
 * `onEndReached` fires again and again while the reader lingers at the bottom.
 */
export function usePaged<T extends { id: string }>(tag: string, fetchPage: (page: number) => Promise<Page<T>>, enabled = true) {
  const [held, setHeld] = useState<{ tag: string; rows: T[] | null; pages: number; next: number | null; error: unknown }>({
    tag,
    rows: null,
    pages: 0,
    next: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const pagesRef = useRef(0);
  pagesRef.current = held.tag === tag ? held.pages : 0;
  // Refs, not rendered state: two end-reached events can land before the re-render.
  const busy = useRef(false);
  const nextRef = useRef<{ tag: string; next: number | null }>({ tag, next: null });
  /** Read pages `from`..`to`; from 1 replaces what is held, otherwise appends. */
  const run = useCallback(
    async (from: number, to: number) => {
      const mine = ++ticket.current;
      busy.current = true;
      setLoading(true);
      try {
        const got: T[] = [];
        let res: Page<T> = { results: [] };
        let last = from;
        for (; last <= to; last++) {
          res = await fetchRef.current(last);
          got.push(...res.results);
          if (!res.next || last === to) break;
        }
        if (mine !== ticket.current) return;
        nextRef.current = { tag, next: res.next ? last + 1 : null };
        setHeld((prev) => {
          const base = from === 1 || prev.tag !== tag ? [] : (prev.rows ?? []);
          const seen = new Set(base.map((r) => r.id));
          const rows = [...base];
          for (const r of got) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            rows.push(r);
          }
          return { tag, rows, pages: last, next: res.next ? last + 1 : null, error: null };
        });
      } catch (e) {
        if (mine === ticket.current) setHeld((prev) => (prev.tag === tag ? { ...prev, error: e } : { tag, rows: null, pages: 0, next: null, error: e }));
      } finally {
        if (mine === ticket.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [tag]
  );
  useEffect(() => {
    if (enabled) void run(1, 1);
  }, [run, enabled]);
  const reload = useCallback(() => run(1, Math.max(1, pagesRef.current)), [run]);
  const loadMore = useCallback(() => {
    const n = nextRef.current;
    if (busy.current || n.tag !== tag || !n.next) return;
    void run(n.next, n.next);
  }, [run, tag]);
  const current = held.tag === tag;
  const next = current ? held.next : null;
  return {
    rows: current ? held.rows : null,
    error: current ? held.error : null,
    loading,
    reload,
    more: next ? loadMore : null,
  };
}

/** One list of posts — a feed sub-page, or one soul's posts. */
export function useFeed(query: { following?: boolean; author?: number }, enabled = true) {
  const tag = JSON.stringify(query);
  const { rows, ...rest } = usePaged<SoulPost>(tag, (page) => soulSocialApi.feed({ ...query, page }), enabled);
  return { posts: rows, ...rest };
}

/**
 * The foot of a paged list. While a page is on its way, a placeholder that says
 * so; while more remain, a button. A `FlatList`'s `onEndReached` does the same
 * for a scroll — the button is for a screen reader, or a reader who stopped short.
 */
export function PagedFooter({ list, testID, title }: { list: { more: (() => void) | null; loading: boolean }; testID: string; title: string }) {
  const { gutter } = useLayout();
  if (!list.more) return null;
  if (list.loading) {
    return (
      <View style={[styles.pad, { paddingHorizontal: gutter }]}>
        <Skeleton lines={2} testID={`${testID}-loading`} />
      </View>
    );
  }
  return (
    <View style={styles.more}>
      <SmallButton testID={testID} title={title} onPress={list.more} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: 24 },
  more: { alignItems: "center", paddingVertical: 20 },
});
