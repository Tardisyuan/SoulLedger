"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type AssignRolesInput } from "../api/index";
import { userKeys } from "../query_keys";

/**
 * 用户管理的写操作。三个都会改列表里的行(角色签、状态),所以成功后整个 `users` 根失效。
 * 只有管理员能调(服务端 `user.manage`,且 IsAdminPermission)。
 */

/** 设置主角色与 / 或兼任角色。 */
export function useAssignUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & AssignRolesInput) =>
      (await usersApi.assignRoles(id, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/** 批量启用 / 停用。返回实际改到的行数 —— 管理员账号与自己不在范围内,所以可能小于所选数。 */
export function useBatchSetUsersActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, active }: { ids: string[]; active: boolean }) =>
      (await (active ? usersApi.batchActivate(ids) : usersApi.batchDeactivate(ids))).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}
