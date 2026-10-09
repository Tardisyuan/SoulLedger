"use client";

import { useQuery } from "@tanstack/react-query";
import { ledgerApi, type LedgerTrendRange } from "../api/index";

/** 仪表盘「趋势」:日快照每天只写一次,所以缓存五分钟,切换范围各缓存各的。 */
export function useLedgerTrends(range: LedgerTrendRange) {
  return useQuery({
    queryKey: ["ledger", "trends", range] as const,
    queryFn: async () => (await ledgerApi.statsTrends(range)).data,
    staleTime: 5 * 60_000,
  });
}
