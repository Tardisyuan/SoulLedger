"use client";

import { useQuery } from "@tanstack/react-query";
import { soulApi } from "../api/soul";
import { soulNotificationKeys } from "../query_keys";

/**
 * One page of the soul's push history. A read-only record — nothing on the
 * client writes it — so the default staleTime stands and pull-to-refresh is
 * `refetch`. Pages are keyed separately: page 2 arriving does not refetch page 1.
 */
export function useSoulNotifications(page = 1) {
  return useQuery({ queryKey: soulNotificationKeys.page(page), queryFn: () => soulApi.notifications(page) });
}
