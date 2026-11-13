"use client";

import { useQuery } from "@tanstack/react-query";
import { soulsApi } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { spineCivOf, spineNow, type SpineCiv, type SpineNow } from "./spineModel";

/**
 * 脊的文明与「现在」。地府只读灵魂本身(`diyu_station`)与案子的殿;其余三家另读 `/souls/{id}/path/`
 * (与灵魂详情的行程图同一把键 `soulKeys.path`,不多发请求),取没离开的那一站。
 */
export function useSpineNow(input: {
  soulId: string | null | undefined;
  civilization: string | null | undefined;
  currentState?: string | null;
  diyuStation?: string | null;
  court?: string | null;
}): { civ: SpineCiv | null; now: SpineNow | null } {
  const civ = spineCivOf(input.civilization);
  const path = useQuery({
    queryKey: soulKeys.path(input.soulId ?? ""),
    queryFn: () => soulsApi.path(input.soulId!).then((r) => r.data),
    enabled: !!input.soulId && civ !== null && civ !== "cn",
    staleTime: 60_000,
  });
  const realmCode = (Array.isArray(path.data) ? path.data : []).find((stop) => stop.left_at === null)?.realm_code ?? null;
  return { civ, now: spineNow({ ...input, realmCode }) };
}
