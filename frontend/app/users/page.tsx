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
      showToast(t("users.delete_success"), "success");
      setDeleteUser(null);
    },
    onError: () => {
      showToast(t("users.delete_error"), "error");
    },
  });

  // Toggle user status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      isActive ? usersApi.activate(id) : usersApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.status_updated"), "success");
    },
    onError: () => {
      showToast(t("users.status_update_error"), "error");
    },
  });

  const users = data?.results ?? [];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <Link href="/" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("users.title")}
        </h1>
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] text-black rounded text-xs font-medium transition-colors"
          >
            + {t("users.create_user")}
          </button>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Search and filters */}
        <div className="flex gap-4 mb-6 flex-wrap">
          <input
            type="text"
            placeholder={t("users.search_placeholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="flex-1 min-w-[200px] bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] transition-colors"
          />
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))] transition-colors"
          >
            <option value="">{t("users.all_roles")}</option>
            <option value="ADMIN">{t("users.roles.ADMIN")}</option>
            <option value="JUDGE">{t("users.roles.JUDGE")}</option>
            <option value="GUARDIAN">{t("users.roles.GUARDIAN")}</option>
            <option value="VIEWER">{t("users.roles.VIEWER")}</option>
          </select>
        </div>

        {/* Users table */}
        <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-2))]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                  {t("users.username")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                  {t("users.email")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                  {t("users.role")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                  {t("users.tenant")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                  {t("users.status")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-ink-subtle uppercase tracking-wider">
                  {t("users.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
              {isLoading ? (
                <TableSkeleton rows={8} cols={6} />
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-muted">
                    {t("users.no_users")}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink))] font-medium">
                      {user.username}
                    </td>
                    <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))]">
                      {user.email}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        user.role === "ADMIN"
                          ? "bg-red-500/20 text-red-400"
                          : user.role === "JUDGE"
                          ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                          : user.role === "GUARDIAN"
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {t(`users.roles.${user.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))]">
                      {user.tenant?.display_name || user.tenant?.code || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={user.is_active ? "text-green-400" : "text-red-400"}>
                        {user.is_active ? t("users.active") : t("users.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => setEditingUser(user)}
                              className="px-2 py-1 text-xs bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              onClick={() => toggleStatusMutation.mutate({
                                id: String(user.id),
                                isActive: !user.is_active,
                              })}
                              disabled={toggleStatusMutation.isPending}
                              className="px-2 py-1 text-xs bg-surface-2 hover:bg-surface-3 border border-hairline rounded text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
                            >
                              {user.is_active ? t("users.deactivate") : t("users.activate")}
                            </button>
                            <button
                              onClick={() => setDeleteUser(user)}
                              className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-red-400 transition-colors"
                            >
                              {t("common.delete")}
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
            <p className="text-sm text-[hsl(var(--color-ink-muted))]">
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
                className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
              >
                ← {t("common.prev")}
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!data.next}
                className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
              >
                {t("common.next")} →
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
