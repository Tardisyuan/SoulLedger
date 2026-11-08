"use client";

import { useQuery } from "@tanstack/react-query";
import { realmsApi } from "../api/index";
import { realmKeys } from "../query_keys";

/**
 * 界域表(全部页都取完)。给 `civilization` 只要那个文明的;不给是全表。退役的(`is_retired`)照样在里面,
 * 选择器自己滤掉 —— 拓扑图与界域页要画它们。界域只在界域页改容量,改时失效 `realmKeys.all`。
 */
export function useRealms(civilization?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: realmKeys.list(civilization),
    queryFn: async () => (await (civilization ? realmsApi.list({ civilization }) : realmsApi.list())).data.results,
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  });
}
