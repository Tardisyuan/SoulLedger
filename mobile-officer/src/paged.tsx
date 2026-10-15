/**
 * 「加载更多」 under a list the server pages (20 a page). `first` is page 1 as `useRemote` holds it;
 * the pages fetched here sit on top of it and are dropped whenever `first` is replaced (reload, another
 * tab), and a page that arrives after that is dropped too. A page that fails leaves the button where it was.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { SmallButton, space, useI18n } from "./shared";

export interface Page<T> {
  results: T[];
  next?: string | null;
}

export function useMoreRows<T extends { id: string | number }>(first: Page<T> | null, fetchPage: (page: number) => Promise<Page<T>>) {
  const [st, setSt] = useState<{ base: Page<T> | null; extra: T[]; page: number; next: boolean }>({ base: null, extra: [], page: 1, next: false });
  const firstRef = useRef(first);
  useEffect(() => {
    firstRef.current = first;
  }, [first]);
  const busy = useRef(false);
  const cur = useMemo(() => (st.base === first ? st : { base: first, extra: [] as T[], page: 1, next: !!first?.next }), [st, first]);
  const loadMore = useCallback(() => {
    if (busy.current || !cur.next) return;
    busy.current = true;
    fetchPage(cur.page + 1)
      .then((res) => {
        if (firstRef.current !== first) return;
        setSt({ base: first, extra: [...cur.extra, ...res.results], page: cur.page + 1, next: !!res.next });
      })
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
      });
  }, [cur, first, fetchPage]);
  if (!first) return { rows: null, more: null };
  const seen = new Set(first.results.map((r) => r.id));
  return { rows: [...first.results, ...cur.extra.filter((r) => !seen.has(r.id))], more: cur.next ? loadMore : null };
}

export function MoreRow({ more }: { more: (() => void) | null }) {
  const { t } = useI18n();
  if (!more) return null;
  return (
    <View style={{ padding: space[5], alignItems: "center" }}>
      <SmallButton testID="list-more" title={t("officer_app.list.more")} onPress={more} />
    </View>
  );
}
