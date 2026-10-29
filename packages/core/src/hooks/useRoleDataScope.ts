"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataScopeApi, type RoleDataScopeConfig } from "../api/index";

export const dataScopeKeys = {
  resources: ["data-scope", "resources"] as const,
  role: (roleId: number) => ["data-scope", "role", roleId] as const,
};

/** 可单独设置范围的业务清单(很少变)。 */
export function useDataScopeResources(enabled = true) {
  return useQuery({
    queryKey: dataScopeKeys.resources,
    queryFn: async () => (await dataScopeApi.getDataScopeResources()).data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useRoleDataScope(roleId: number, enabled = true) {
  return useQuery({
    queryKey: dataScopeKeys.role(roleId),
    queryFn: async () => (await dataScopeApi.getRoleDataScope(roleId)).data,
    enabled,
  });
}

/** 整份替换。成功后把服务器回的那份写进缓存。提示由调用方给(要说「对方刷新后生效」)。 */
export function useSaveRoleDataScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roleId, body }: { roleId: number; body: RoleDataScopeConfig }) =>
      (await dataScopeApi.putRoleDataScope(roleId, body)).data,
    onSuccess: (data, { roleId }) => qc.setQueryData(dataScopeKeys.role(roleId), data),
  });
}
