"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionsApi } from "../api/index";
import { signInSessionKeys } from "../query_keys";

/** 登录设备列表:这台在前,其余按上次活动倒序(服务端排好)。 */
export function useSignInSessions() {
  return useQuery({
    queryKey: signInSessionKeys.all,
    queryFn: () => sessionsApi.list().then((r) => r.data),
  });
}

/**
 * 退出一台。成功**不**立刻重取列表:行要先显示「已退出」3 秒再消失(Design W2),
 * 由调用方在那之后 `invalidate`。
 */
export function useRevokeSession() {
  return useMutation({ mutationFn: (id: string) => sessionsApi.revoke(id) });
}

/** 退出其他全部;成功后列表只剩这台,立刻重取。 */
export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.revokeOthers().then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signInSessionKeys.all }),
  });
}
