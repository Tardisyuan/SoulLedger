"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useImpersonation } from "./useImpersonation";

// 进殿查看到期:到点(一个定时器,不轮询)或服务端对过期令牌回 401/403 时为真。到期不跳走,页面内容换成到期页。
const flagged = new Set<number>();
const listeners = new Set<() => void>();

export function markHallViewExpired(id: number): void {
  if (flagged.has(id)) return;
  flagged.add(id);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** 当前是进殿查看且已到期。非进殿查看恒为 false。 */
export function useHallViewExpired(): boolean {
  const state = useImpersonation();
  const hall = state?.hallView ? state : null;
  const id = hall?.id ?? -1;
  const byServer = useSyncExternalStore(subscribe, () => flagged.has(id), () => false);
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = hall?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const wait = expiresAt - Date.now();
    if (wait <= 0) return setNow(Date.now());
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return Boolean(hall) && (byServer || (expiresAt !== undefined && now >= expiresAt));
}
