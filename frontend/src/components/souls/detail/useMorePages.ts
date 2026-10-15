"use client";

import { useQueries } from "@tanstack/react-query";
import type { PaginatedResponse } from "@soulledger/core/api";

/**
 * 灵魂详情的时间线只取了每种记录的第 1 页;「加载更多」再取第 2..n+1 页,接在第 1 页后面。
 * 键必须挂在各自的族前缀下(调用方给),这样页面的 `refreshSoulViews` 一次失效能同时够到它们。
 * `loading` 为真表示还有一页在路上(按钮转圈,不重复点)。
 * 每种记录按自己的总数(`total`)与第 1 页的条数(`pageSize`)算还有没有下一页:四种一起翻页,
 * 先取完的那种不再请求 —— 越过末页后端回 404,会被当成「加载失败」。
 */
export function useMorePages<T>(
  key: readonly unknown[],
  fetchPage: (page: number) => Promise<PaginatedResponse<T>>,
  extraPages: number,
  enabled: boolean,
  total: number,
  pageSize: number
): { rows: T[]; loading: boolean; failed: boolean } {
  const results = useQueries({
    queries: Array.from({ length: extraPages }, (_, i) => ({
      queryKey: [...key, "page", i + 2],
      queryFn: async () => (await fetchPage(i + 2)).results,
      enabled: enabled && pageSize > 0 && (i + 1) * pageSize < total,
      staleTime: 30_000,
    })),
  });
  return {
    rows: results.flatMap((r) => r.data ?? []),
    loading: results.some((r) => r.isFetching && r.data === undefined),
    failed: results.some((r) => r.isError),
  };
}
