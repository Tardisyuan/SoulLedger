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
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

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
      return res.data;
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
    /* `page` (1200px), up from the `max-w-6xl` (1152) this page picked for
       itself. Six columns, one of which is a three-button action group. */
    <PageShell
      variant="page"
      title={
        <>
          {t("users.title")}
          <MenuGloss path="/users" />
        </>
      }
      backLink={
        <Link href="/" className="text-03 text-ink-muted hover:text-ink">
          ← {t("nav.home")}
        </Link>
      }
      actions={
        <RequirePermission permissions="user.create">
          <Button type="button" variant="primary" onClick={() => setIsModalOpen(true)}>
            + {t("users.create_user")}
          </Button>
        </RequirePermission>
      }
      filters={
        /* Both controls take the shared `fieldControl` skin rather than
           `Field`: the row is 32px of content height and a `Field` stacks a
           visible label above its control, which does not fit and would push
           the sticky bar to twice its height. The accessible name therefore
           rides on `aria-label` — the same call `app/souls/page.tsx` already
           documents for its own filter row, now spelled the same way in both
           places instead of two (`bg-surface-1 rounded` here, `bg-surface-2
           rounded-md` there). */
        <>
          <input
            type="text"
            placeholder={t("users.search_placeholder")}
            aria-label={t("users.search_placeholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
          />
          <select
            value={roleFilter}
            aria-label={t("users.role")}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className={cn(fieldControl({ size: "md" }), "w-auto shrink-0")}
          >
            <option value="">{t("users.all_roles")}</option>
            <option value="ADMIN">{t("users.roles.ADMIN")}</option>
            <option value="JUDGE">{t("users.roles.JUDGE")}</option>
            <option value="GUARDIAN">{t("users.roles.GUARDIAN")}</option>
            <option value="VIEWER">{t("users.roles.VIEWER")}</option>
          </select>
        </>
      }
    >
      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the end. */}
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
            <td className="px-4 py-3 text-ink font-medium">
              {user.username}
            </td>
            <td className="px-4 py-3 text-ink-muted">
              {user.email}
            </td>
            <td className="px-4 py-3">
              {/* The four role tints are unchanged, only re-housed: `Badge`
                  owns the 2px vertical padding a badge needs (it is the one
                  file `eslint.config.mjs` exempts from the spacing rhythm for
                  exactly that class), so a hand-rolled `py-0.5` span is the
                  one shape this row cannot keep. Which palette a *role*
                  should draw from is a live question — see the
                  `ROLE_BADGE_CLASSES` entry in statusTokenLayering.test.ts —
                  and answering it is not this pass's job, so the tints stay
                  put and stay inline rather than becoming a named map that
                  would enrol this page as a fifth recorded offender. */}
              <Badge
                className={
                  user.role === "ADMIN"
                    ? "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))]"
                    : user.role === "JUDGE"
                    ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))]"
                    : user.role === "GUARDIAN"
                    ? "bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))]"
                    : "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))]"
                }
              >
                <DomainEnum namespace="users.roles" value={user.role} />
              </Badge>
            </td>
            <td className="px-4 py-3 text-ink-muted">
              {user.tenant?.display_name || user.tenant?.code || "-"}
            </td>
            <td className="px-4 py-3">
              <span className={user.is_active ? "text-[hsl(var(--color-status-success))]" : "text-[hsl(var(--color-status-error))]"}>
                {user.is_active ? t("users.active") : t("users.inactive")}
              </span>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-2">
                <RequirePermission permissions="user.update">
                  <Button type="button" size="sm" onClick={() => setEditingUser(user)}>
                    {t("common.edit")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions={["user.update", "user.activate"]}>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => toggleStatusMutation.mutate({
                      id: String(user.id),
                      isActive: !user.is_active,
                    })}
                    disabled={toggleStatusMutation.isPending}
                  >
                    {user.is_active ? t("users.deactivate") : t("users.activate")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="user.delete">
                  <Button type="button" size="sm" variant="danger" onClick={() => setDeleteUser(user)}>
                    {t("common.delete")}
                  </Button>
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
    </PageShell>
  );
}
