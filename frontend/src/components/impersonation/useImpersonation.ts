"use client";

import { useSyncExternalStore } from "react";
import { getImpersonation, subscribeImpersonation, type ImpersonationState } from "@soulledger/core/api/impersonation";

/** 「以此人身份查看」此刻的状态(没有在看 → null)。存在 session 存储里,刷新、换页都还在。 */
export function useImpersonation(): ImpersonationState | null {
  return useSyncExternalStore(subscribeImpersonation, getImpersonation, () => null);
}
