"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, permApi, PAGE_SIZE, type User, type PaginatedResponse } from "@soulledger/core/api";
import { permissionKeys, userKeys } from "@soulledger/core/query_keys";
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
import { FilterChipSelect } from "@/src/components/ui/FilterChip";

/** The row `?username=` located. */
const LOCATED_BG = "bg-[oklch(var(--color-surface-2))]";

export default function UsersPage() {
  // useSearchParams needs a Suspense boundary under the App Router build (as app/death-sync/page.tsx).
  return (
    <Suspense fallback={null}>
      <UsersRoute />
    </Suspense>
  );
}

function UsersRoute() {
  const { t } = useI18n();
  const router = useRouter();
  // `?username=<u>`: the password-help notification's 「去用户页」 (第三类 F 组 2.6) lands on
  // exactly that account — an exact-match filter on the server, and the row highlighted.
  // No such account → the normal empty result.
  const located = useSearchParams().get("username") ?? "";
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
    queryKey: userKeys.list({ page, search, role: roleFilter, ordering, username: located }),
    queryFn: async () => {
      const res = await usersApi.list({
        page,
        search,
        role: roleFilter || undefined,
        ordering: ordering || undefined,
        username: located || undefined,
      });
      return res.data;
    },
  });

  // The filter's options come from the role table (see UserModal for why a
  // fixed list is wrong now that custom roles can be held). Built-ins keep
  // their translated label via `users.roles.*`; a custom role shows its
  // server-side display_name, which is data rather than UI copy.
  const rolesQuery = useQuery({
    queryKey: permissionKeys.roles,
    queryFn: async () => (await permApi.roles.list()).data,
  });
  const roleFilterOptions = (rolesQuery.data ?? []).map((r) => ({
    value: r.name,
    label: r.is_builtin ? t(`users.roles.${r.name}`) : r.display_name || r.name,
  }));
  // The same table, by name, for the badge in each row. A custom role has no
  // `users.roles.*` entry and cannot — its name is data, not UI copy — so
  // `DomainEnum` rendered it as "unrecognised", italic, with the name hidden in
  // `title`. The filter above already reads `display_name` for it; the badge
  // is the same decision one column over. `UsersPage.roleBadge.test.tsx`.
  const customRoleLabel = (roleName: string): string | null => {
    const role = rolesQuery.data?.find((r) => r.name === roleName);
    return role && !role.is_builtin ? role.display_name || role.name : null;
  };

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
        <Link href="/" className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]">
          ← {t("nav.home")}
        </Link>
      }
      actions={
        <RequirePermission permissions="user.manage">
          <Button type="button" variant="primary" onClick={() => setIsModalOpen(true)}>
            + {t("users.create_user")}
          </Button>
        </RequirePermission>
      }
      filters={
        /* The search box takes the shared `fieldControl` skin rather than
           `Field` (the role filter is a chip, below): the row is 32px of content height and a `Field` stacks a
           visible label above its control, which does not fit and would push
           the sticky bar to twice its height. The accessible name therefore
           rides on `aria-label` — the same call `app/souls/page.tsx` already
           documents for its own filter row, now spelled the same way in both
           places instead of two (`bg-surface-1` here, `bg-surface-2
           ` there). */
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
          {/* 筛选签(规范 v1 §2)。选项仍来自角色表,不是写死的清单:
              MODERATOR 曾经从一份手写清单里漏掉,整行无法筛选。 */}
          <FilterChipSelect
            label={t("users.role")}
            value={roleFilter}
            options={[{ value: "", label: t("users.all_roles") }, ...roleFilterOptions]}
            clearLabel={t("filter.clear_one", { name: t("users.role") })}
            onChange={(v) => {
              setRoleFilter(v);
              setPage(1);
            }}
          />
        </>
      }
    >
      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the end. */}
      {/* `compact` (~36px rows) because this page is scan-and-find: the operator
          is looking for a row, not deciding on each one. Decision surfaces
          (the judgment list) stay `comfortable`. */}
      <DataTable<User>
        density="compact"
        caption={t("users.title")}
        columns={[
          { key: "username", header: t("users.username"), sortable: true },
          { key: "email", header: t("users.email"), sortable: true },
          { key: "role", header: t("users.role"), sortable: true },
          { key: "tenant", header: t("users.tenant") },
          { key: "status", header: t("users.status") },
          { key: "actions", header: t("users.actions"), align: "right", srOnlyHeader: true },
        ]}
        data={users}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        keyExtractor={(user) => String(user.id)}
        renderRow={(user) => (
          <>
            <td
              data-located={user.username === located ? "" : undefined}
              className={cn(
                "px-4 py-3 text-[oklch(var(--color-ink))] font-medium",
                user.username === located && "shadow-[inset_3px_0_0_oklch(var(--color-accent))]",
                user.username === located && LOCATED_BG
              )}
            >
              {user.username}
            </td>
            <td className={cn("px-4 py-3 text-[oklch(var(--color-ink-muted))]", user.username === located && LOCATED_BG)}>
              {user.email}
            </td>
            <td className={cn("px-4 py-3", user.username === located && LOCATED_BG)}>
              {/* 规范 v1 §2「徽章 · 只有常态」:无底色,字与 1 px 边同色。角色是身份,
                  不是系统状态,所以不借反馈色 —— 一律中性,名字本身区分。 */}
              <Badge>
                {customRoleLabel(user.role) ?? (
                  <DomainEnum namespace="users.roles" value={user.role} />
                )}
              </Badge>
            </td>
            <td className={cn("px-4 py-3 text-[oklch(var(--color-ink-muted))]", user.username === located && LOCATED_BG)}>
              {user.tenant?.display_name || user.tenant?.code || "-"}
            </td>
            <td className={cn("px-4 py-3", user.username === located && LOCATED_BG)}>
              {/* 状态 = 颜色 + 字形(规范 v1 §1.2),不只靠颜色。 */}
              <Badge tone={user.is_active ? "success" : "neutral"} glyph={user.is_active ? "✓" : "○"}>
                {user.is_active ? t("users.active") : t("users.inactive")}
              </Badge>
            </td>
            <td className={cn("px-4 py-3 text-right", user.username === located && LOCATED_BG)}>
              <div className="flex items-center justify-end gap-1">
                <RequirePermission permissions="user.manage">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingUser(user)}>
                    {t("common.edit")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="user.manage">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleStatusMutation.mutate({
                      id: String(user.id),
                      isActive: !user.is_active,
                    })}
                    disabled={toggleStatusMutation.isPending}
                  >
                    {user.is_active ? t("users.deactivate") : t("users.activate")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="user.manage">
                  <Button type="button" size="sm" variant="ghost" className="text-[oklch(var(--color-danger))]" onClick={() => setDeleteUser(user)}>
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
        isFiltered={Boolean(search || roleFilter || located)}
        onClearFilters={() => {
          setSearch("");
          setRoleFilter("");
          setPage(1);
          if (located) router.replace("/users");
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
