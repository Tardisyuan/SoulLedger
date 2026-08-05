"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, PAGE_SIZE, type User, type PaginatedResponse } from "@/lib/api";
import { userKeys } from "@/lib/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { UserModal } from "@/src/components/users/UserModal";
import { UserDeleteDialog } from "@/src/components/users/UserDeleteDialog";
import { showToast } from "@/src/components/ui/Toast";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable, parseOrdering, type SortState } from "@/components/ui/data-table";

export default function UsersPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [ordering, setOrdering] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  // Fetch users list — params live in the queryKey, so filter/sort/page changes refetch on their own.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: userKeys.list({ page, search, role: roleFilter, ordering }),
    queryFn: async () => {
      const res = await usersApi.list({ page, search, role: roleFilter || undefined, ordering: ordering || undefined });
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
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <Link href="/" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("users.title")}
        </h1>
        <RequirePermission permissions="user.create">
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] text-black rounded text-xs font-medium transition-colors"
          >
            + {t("users.create_user")}
          </button>
        </RequirePermission>
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

        <DataTable<User>
          caption={t("users.title")}
          columns={[
            { key: "username", header: t("users.username"), sortable: true },
            { key: "email", header: t("users.email"), sortable: true },
            { key: "role", header: t("users.role"), sortable: true },
            { key: "tenant", header: t("users.tenant") },
            { key: "status", header: t("users.status") },
            { key: "actions", header: t("users.actions"), align: "right" },
          ]}
          data={users}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          keyExtractor={(user) => String(user.id)}
          renderRow={(user) => (
            <>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink))] font-medium">
                {user.username}
              </td>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))]">
                {user.email}
              </td>
              <td className="px-4 py-3 text-sm">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  user.role === "ADMIN"
                    ? "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]"
                    : user.role === "JUDGE"
                    ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                    : user.role === "GUARDIAN"
                    ? "bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]"
                    : "bg-[hsl(var(--color-status-lost)/0.2)] text-[hsl(var(--color-status-lost))]"
                }`}>
                  {t(`users.roles.${user.role}`)}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))]">
                {user.tenant?.display_name || user.tenant?.code || "-"}
              </td>
              <td className="px-4 py-3 text-sm">
                <span className={user.is_active ? "text-[hsl(var(--color-status-success))]" : "text-[hsl(var(--color-status-error))]"}>
                  {user.is_active ? t("users.active") : t("users.inactive")}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-right">
                <div className="flex items-center justify-end gap-2">
                  <RequirePermission permissions="user.update">
                    <button
                      onClick={() => setEditingUser(user)}
                      className="px-2 py-1 text-xs bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
                    >
                      {t("common.edit")}
                    </button>
                  </RequirePermission>
                  <RequirePermission permissions={["user.update", "user.activate"]}>
                    <button
                      onClick={() => toggleStatusMutation.mutate({
                        id: String(user.id),
                        isActive: !user.is_active,
                      })}
                      disabled={toggleStatusMutation.isPending}
                      className="px-2 py-1 text-xs bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors disabled:opacity-50"
                    >
                      {user.is_active ? t("users.deactivate") : t("users.activate")}
                    </button>
                  </RequirePermission>
                  <RequirePermission permissions="user.delete">
                    <button
                      onClick={() => setDeleteUser(user)}
                      className="px-2 py-1 text-xs bg-[hsl(var(--color-status-error)/0.2)] hover:bg-[hsl(var(--color-status-error)/0.3)] border border-[hsl(var(--color-status-error)/0.3)] rounded text-[hsl(var(--color-status-error))] transition-colors"
                    >
                      {t("common.delete")}
                    </button>
                  </RequirePermission>
                </div>
              </td>
            </>
          )}
          sort={parseOrdering(ordering)}
          onSortChange={(next) => {
            setOrdering(next ? `${next.direction === "desc" ? "-" : ""}${next.key}` : "");
            setPage(1);
          }}
          isFiltered={Boolean(search || roleFilter)}
          onClearFilters={() => {
            setSearch("");
            setRoleFilter("");
            setPage(1);
          }}
          emptyMessage={t("users.no_users")}
          page={page}
          totalPages={Math.ceil((data?.count || 0) / PAGE_SIZE)}
          totalCount={data?.count}
          onPageChange={setPage}
        />
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
