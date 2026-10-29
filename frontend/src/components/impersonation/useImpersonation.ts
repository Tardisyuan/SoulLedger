"use client";

import { useSyncExternalStore } from "react";
import { getImpersonation, subscribeImpersonation, type ImpersonationState } from "@soulledger/core/api/impersonation";

/** 只读类权限码(`*.read` / `*.view` / `*.list`):代看时照常可用,其余按写操作处理。ViewingLock 与 usePermissions 共用。 */
export const READ_ONLY_CODENAME = /\.(read|view|list)$/;

/** 「以此人身份查看」此刻的状态(没有在看 → null)。存在 session 存储里,刷新、换页都还在。 */
export function useImpersonation(): ImpersonationState | null {
  return useSyncExternalStore(subscribeImpersonation, getImpersonation, () => null);
}
