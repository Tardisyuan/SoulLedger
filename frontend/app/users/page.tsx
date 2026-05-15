"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type User, type PaginatedResponse } from "@/lib/api";
import { userKeys } from "@/lib/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { UserModal } from "@/src/components/users/UserModal";
import { UserDeleteDialog } from "@/src/components/users/UserDeleteDialog";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理员",
  JUDGE: "审判者",
  GUARDIAN: "守护者",
  VIEWER: "查看者",
};

export default function UsersPage() {
  const { t } = useI18n();
  const { isAdmin } = useTenant();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  // Fetch users list
  const { data, isLoading, isFetching } = useQuery({
    queryKey: userKeys.list({ page, search, role: roleFilter }),
    queryFn: async () => {
      const res = await usersApi.list({ page, search, role: roleFilter || undefined });
      return res.data as PaginatedResponse<User>;
    },
  });

  // Delete user mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.delete_success") || "用户已删除", "success");
      setDeleteUser(null);
    },
    onError: () => {
      showToast(t("users.delete_error") || "用户删除失败", "error");
    },
  });

  // Toggle user status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      isActive ? usersApi.activate(id) : usersApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.status_updated") || "状态已更新", "success");
    },
    onError: () => {
      showToast(t("users.status_update_error") || "状态更新失败", "error");
    },
  });

  const users = data?.results ?? [];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-hairline/50">
        <Link href="/" className="text-ink-muted hover:text-ink text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-lg font-bold text-amber-400 flex-1">
          {t("users.title") || "用户管理"}
        </h1>
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black rounded text-xs font-medium transition-colors"
          >
            + {t("users.create_user") || "创建用户"}
          </button>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Search and filters */}
        <div className="flex gap-4 mb-6 flex-wrap">
          <input
            type="text"
            placeholder={t("users.search_placeholder") || "搜索用户名或邮箱..."}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="flex-1 min-w-[200px] bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500 transition-colors"
          />
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500 transition-colors"
          >
            <option value="">{t("users.all_roles") || "所有角色"}</option>
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
            <option value="JUDGE">{ROLE_LABELS.JUDGE}</option>
            <option value="GUARDIAN">{ROLE_LABELS.GUARDIAN}</option>
            <option value="VIEWER">{ROLE_LABELS.VIEWER}</option>
          </select>
        </div>

        {/* Users table */}
        <div className="bg-surface-1 rounded-lg border border-hairline overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline bg-surface-2">
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.username") || "用户名"}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.email") || "邮箱"}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.role") || "角色"}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.tenant") || "租户"}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.status") || "状态"}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.actions") || "操作"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {isLoading ? (
                <TableSkeleton rows={8} cols={6} />
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-muted">
                    {t("users.no_users") || "暂无用户"}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-ink font-medium">
                      {user.username}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-muted">
                      {user.email}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        user.role === "ADMIN"
                          ? "bg-red-500/20 text-red-400"
                          : user.role === "JUDGE"
                          ? "bg-amber-500/20 text-amber-400"
                          : user.role === "GUARDIAN"
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {ROLE_LABELS[user.role] || user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-muted">
                      {user.tenant?.display_name || user.tenant?.code || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={user.is_active ? "text-green-400" : "text-red-400"}>
                        {user.is_active ? (t("users.active") || "启用") : (t("users.inactive") || "禁用")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => setEditingUser(user)}
                              className="px-2 py-1 text-xs bg-surface-2 hover:bg-surface-3 border border-hairline rounded text-ink-muted hover:text-ink transition-colors"
                            >
                              {t("common.edit") || "编辑"}
                            </button>
                            <button
                              onClick={() => toggleStatusMutation.mutate({
                                id: String(user.id),
                                isActive: !user.is_active,
                              })}
                              disabled={toggleStatusMutation.isPending}
                              className="px-2 py-1 text-xs bg-surface-2 hover:bg-surface-3 border border-hairline rounded text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
                            >
                              {user.is_active ? (t("users.deactivate") || "禁用") : (t("users.activate") || "启用")}
                            </button>
                            <button
                              onClick={() => setDeleteUser(user)}
                              className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-red-400 transition-colors"
                            >
                              {t("common.delete") || "删除"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {isLoading ? (
          <div className="flex items-center justify-between mt-4">
            <Skeleton className="h-4 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        ) : data && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-ink-muted">
              {t("users.page_info", {
                page: String(page),
                total: String(Math.ceil((data.count || 0) / 20)),
                count: String(data.count || 0),
              })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm bg-surface-1 border border-hairline rounded hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed text-ink-muted hover:text-ink transition-colors"
              >
                ← {t("common.prev") || "上一页"}
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!data.next}
                className="px-3 py-1.5 text-sm bg-surface-1 border border-hairline rounded hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed text-ink-muted hover:text-ink transition-colors"
              >
                {t("common.next") || "下一页"} →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <UserModal
        isOpen={isModalOpen || !!editingUser}
        onClose={() => {
          setIsModalOpen(false);
          setEditingUser(null);
        }}
        user={editingUser}
      />

      {/* Delete Confirmation Dialog */}
      <UserDeleteDialog
        user={deleteUser}
        isOpen={!!deleteUser}
        onClose={() => setDeleteUser(null)}
      />
    </div>
  );
}
