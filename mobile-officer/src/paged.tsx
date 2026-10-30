/**
 * 「加载更多」 under a list the server pages (20 a page). `first` is page 1 as `useRemote` holds it;
 * the pages fetched here sit on top of it. A reload that replaces `first` fetches them again (below); another
 * tab or group (`first` goes null first) drops them, and a page that arrives after that is dropped too. While a page is on its way the button is busy;
 * a page that fails leaves the rows where they were and says so under them, with 重试.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { Loader, Notice, SmallButton, space, useI18n } from "./shared";

export interface Page<T> {
  results: T[];
  next?: string | null;
}

export type MoreState = "busy" | "failed" | null;

export function useMoreRows<T extends { id: string | number }>(first: Page<T> | null, fetchPage: (page: number) => Promise<Page<T>>) {
  const [st, setSt] = useState<{ base: Page<T> | null; extra: T[]; page: number; next: boolean }>({ base: null, extra: [], page: 1, next: false });
  // Which `first` the busy / failed mark belongs to: a reload drops it with the extra pages.
  const [mark, setMark] = useState<{ base: Page<T> | null; state: MoreState }>({ base: null, state: null });
  const firstRef = useRef(first);
  useEffect(() => {
    firstRef.current = first;
  }, [first]);
  const busy = useRef(false);
  // A reload replaced page 1 while more pages were showing (opt-apps2 N1): they stay on screen and are fetched
  // again behind it, so the list keeps its length and its scroll. A list that now ends on page 1, or a page that
  // fails, drops them -- the old rule. `first` going null (another key / group) starts over.
  const rebase = !!first?.next && st.base !== null && st.base !== first && st.extra.length > 0;
  const cur = useMemo(
    () => (st.base === first ? st : rebase ? { ...st, base: first } : { base: first, extra: [] as T[], page: 1, next: !!first?.next }),
    [st, first, rebase]
  );
  // Set while rendering (React's "adjusting state when a prop changes"): the next `first` must not see these pages.
  if (first === null && st.base !== null) setSt({ base: null, extra: [], page: 1, next: false });
  useEffect(() => {
    if (!rebase || !first) return;
    const pages = st.page;
    const settle = (next: typeof st) => setSt((prev) => (prev.base === first || firstRef.current !== first ? prev : next));
    void (async () => {
      const extra: T[] = [];
      let next = true;
      let page = 1;
      while (page < pages && next) {
        const res = await fetchPage(++page);
        extra.push(...res.results);
        next = !!res.next;
      }
      return { extra, next, page };
    })().then(
      ({ extra, next, page }) => settle({ base: first, extra, page, next }),
      () => settle({ base: first, extra: [], page: 1, next: !!first.next })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per replaced page 1
  }, [first, rebase]);
  const loadMore = useCallback(() => {
    if (busy.current || !cur.next) return;
    busy.current = true;
    setMark({ base: first, state: "busy" });
    fetchPage(cur.page + 1)
      .then((res) => {
        if (firstRef.current !== first) return;
        setSt({ base: first, extra: [...cur.extra, ...res.results], page: cur.page + 1, next: !!res.next });
        setMark({ base: first, state: null });
      })
      .catch(() => {
        if (firstRef.current === first) setMark({ base: first, state: "failed" });
      })
      .finally(() => {
        busy.current = false;
      });
  }, [cur, first, fetchPage]);
  if (!first) return { rows: null, more: null, moreState: null as MoreState };
  const seen = new Set(first.results.map((r) => r.id));
  return {
    rows: [...first.results, ...cur.extra.filter((r) => !seen.has(r.id))],
    more: cur.next ? loadMore : null,
    moreState: mark.base === first ? mark.state : null,
  };
}

export function MoreRow({ more, state = null }: { more: (() => void) | null; state?: MoreState }) {
  const { t } = useI18n();
  if (!more) return null;
  if (state === "failed") {
    return (
      <View style={{ padding: space[5] }}>
        <Notice tone="neg" onRetry={more} testID="list-more-failed">
          {t("officer_app.list.more_failed")}
        </Notice>
      </View>
    );
  }
  return (
    <View style={{ padding: space[5], alignItems: "center" }}>
      {state === "busy" ? <Loader size={20} testID="list-more-busy" /> : <SmallButton testID="list-more" title={t("officer_app.list.more")} onPress={more} />}
    </View>
  );
}
