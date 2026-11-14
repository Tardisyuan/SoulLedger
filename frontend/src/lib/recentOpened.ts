import { useEffect } from "react";

/**
 * 「最近打开」(搜索面板空着时那一组)。原来只记从搜索面板点开的条目(`GlobalSearch.tsx`);便利性审查
 * 2026-11-15 D5:详情页一挂载就记,从列表、链接、通知、地址栏进来的也算。上限 10 条,按用户分键,
 * 只在这台浏览器里。每一次读写都兜住:记不住只是这一组少几行。
 */
export const RECENT_LIMIT = 10;

export type RecentKind = "judgment" | "soul" | "statute" | "page";

/** 存进本地的一条:只存画这一行要的字,不存整条记录。 */
export interface RecentItem {
  kind: RecentKind;
  id: string;
  href: string;
  title: string;
  sub?: string;
}

const recentKey = (userId: number | string | undefined) => `soulledger.search.recent.${userId ?? "anon"}`;

export function readRecent(userId: number | string | undefined): RecentItem[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(userId: number | string | undefined, item: RecentItem): void {
  try {
    const next = [item, ...readRecent(userId).filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    /* 隐私模式等:这一次不记。 */
  }
}

/**
 * 详情页挂载、数据到了就记一次。`item` 为 null(还在加载、或没有用户)时不记;
 * 用户没登录(`userId` 为空)也不记 —— 不写进 `anon` 那一格。
 */
export function useRecordOpened(userId: number | string | undefined, item: RecentItem | null): void {
  const { kind, id, href, title, sub } = item ?? ({} as Partial<RecentItem>);
  useEffect(() => {
    if (userId === undefined || userId === null || !kind || !id || !href || !title) return;
    pushRecent(userId, { kind, id, href, title, ...(sub ? { sub } : {}) });
  }, [userId, kind, id, href, title, sub]);
}
