"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataScopeApi, type DataScopeResource, type RoleDataScopeConfig } from "../api/index";

export const dataScopeKeys = {
  resources: ["data-scope", "resources"] as const,
  role: (roleId: number) => ["data-scope", "role", roleId] as const,
};

// 形状不对就当读取失败:界面显示「数据范围读取失败」,而不是在渲染时对着一个分页对象 `.map` / `.scope` 崩掉整个抽屉。
const isRule = (r: unknown): boolean =>
  !!r && typeof (r as { scope?: unknown }).scope === "string" && Array.isArray((r as { orgs?: unknown }).orgs);

/** 可单独设置范围的业务清单(很少变)。 */
export function useDataScopeResources(enabled = true) {
  return useQuery({
    queryKey: dataScopeKeys.resources,
    queryFn: async () => {
      const data: unknown = (await dataScopeApi.getDataScopeResources()).data;
      if (!Array.isArray(data)) throw new Error("unexpected data-scope resources response");
      return data as DataScopeResource[];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useRoleDataScope(roleId: number, enabled = true) {
  return useQuery({
    queryKey: dataScopeKeys.role(roleId),
    queryFn: async () => {
      const data = (await dataScopeApi.getRoleDataScope(roleId)).data as Partial<RoleDataScopeConfig> | null;
      const ok = !!data && isRule(data.default) && Array.isArray(data.overrides) && data.overrides.every(isRule);
      if (!ok) throw new Error("unexpected role data-scope response");
      return data as RoleDataScopeConfig;
    },
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
