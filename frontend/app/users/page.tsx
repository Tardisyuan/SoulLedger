"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, permApi, handoverApi, openWorkOf, PAGE_SIZE, type User } from "@soulledger/core/api";
import { permissionKeys, userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { UserModal } from "@/src/components/users/UserModal";
import { UserDeleteDialog } from "@/src/components/users/UserDeleteDialog";
import { UserRolesDialog } from "@/src/components/users/UserRolesDialog";
import { UserRoleChips } from "@/src/components/users/UserRoleChips";
import { UserBatchBar, useUserSelection, type HeldOfficer } from "@/src/components/users/UserBatchBar";
import { MfaResetDialog } from "@/src/components/users/MfaResetDialog";
import { PasswordResetDialog } from "@/src/components/users/PasswordResetDialog";
import { ExportCsvButton } from "@/src/components/ExportCsvButton";
import { UserImportDialog } from "@/src/components/users/UserImportDialog";
import { OfficerInviteDialog } from "@/src/components/users/OfficerInviteDialog";
import { OfficerHandoverDialog, previewTotal } from "@/src/components/users/OfficerHandoverDialog";
import { ImpersonateDialog } from "@/src/components/impersonation/ImpersonateDialog";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { RequireAdmin, RequirePermission } from "@/src/components/rbac/RequirePermission";
import { usePermissions } from "@/src/hooks/usePermissions";
import { DataTable, parseOrdering, type DataTableColumn } from "@/components/ui/data-table";
import { ColumnMenu, useColumnVisibility } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { useRememberedFilters } from "@/src/lib/rememberedFilters";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { EvalIdentityTag } from "@/src/components/assist-admin/parts";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * The row `?username=` located: s2 底(选中行),**不加行首色标** —— 规范 v2 B12 把行首色标
 * 定为「待我处理」专用、只在审判的两个列表上;这里曾是一道 inset 阴影画的 accent 竖条,
 * 同时也违反「全站无阴影」。
 */
const LOCATED_BG = "bg-[oklch(var(--color-surface-2))]";

/** 角色、MFA 两个下拉和排序记在本浏览器;搜索框的字和 `?username=` 带来的账号属于一次到访,不记。 */
const USERS_FILTERS_KEY = "soulledger.users.filters";
/** 列菜单的偏好,一个列表一份。 */
const USERS_COLUMNS_KEY = "soulledger.users.columns";
const USERS_FILTER_FIELDS = ["role", "mfa", "ordering"] as const;

export default function UsersPage() {
  // useSearchParams needs a Suspense boundary under the App Router build (as app/death-sync/page.tsx).
  // 页级门(rbac-web L-1):users/ 是 IsAdmin + user.manage;殿主的交接入口在审判队列。
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <Suspense fallback={null}>
        <UsersRoute />
      </Suspense>
    </RequireAdmin>
  );
}

function UsersRoute() {
  const { t } = useI18n();
  const hall = useHall(t("plaque.office.rules"));
  usePlaque({ hall });
  const router = useRouter();
  // `?username=<u>`: the password-help notification's 「去用户页」 (第三类 F 组 2.6) lands on
  // exactly that account — an exact-match filter on the server, and the row highlighted.
  // No such account → the normal empty result.
  const searchParams = useSearchParams();
  const located = searchParams.get("username") ?? "";
  // `?organization=<id>`: 机构页「查看人员」落在这里,只列该机构的直属人员。
  const organization = searchParams.get("organization") ?? "";
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [ordering, setOrdering] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [handoverUser, setHandoverUser] = useState<User | null>(null);
  /** 手上有事的官员:停用要经交接对话框(选接手人,交接与停用同一个事务)。 */
  const [deactivateWith, setDeactivateWith] = useState<User | null>(null);
  const [held, setHeld] = useState<HeldOfficer[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [rolesUser, setRolesUser] = useState<User | null>(null);
  // 批量启用 / 停用与设置角色同一道门:服务端 `user.manage`(只有管理员持有)。没有它就没有勾选列。
  const { hasPermission, isAdmin } = usePermissions();
  const canManage = hasPermission("user.manage");
  const myId = useTenant().user?.id;
  const [impersonateUser, setImpersonateUser] = useState<User | null>(null);
  const [mfaFilter, setMfaFilter] = useState("");
  useRememberedFilters(
    USERS_FILTERS_KEY,
    USERS_FILTER_FIELDS,
    { role: roleFilter, mfa: mfaFilter, ordering },
    (saved) => {
      if (saved.role) setRoleFilter(saved.role);
      if (saved.mfa) setMfaFilter(saved.mfa);
      if (saved.ordering) setOrdering(saved.ordering);
    },
    Boolean(located)
  );
  const [resetMfaUser, setResetMfaUser] = useState<User | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);

  // Fetch users list — params live in the queryKey, so filter/sort/page changes refetch on their own.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: userKeys.list({ page, search, role: roleFilter, ordering, username: located, mfa: mfaFilter, organization }),
    queryFn: async () => {
      const res = await usersApi.list({
        page,
        search,
        role: roleFilter || undefined,
        ordering: ordering || undefined,
        username: located || undefined,
        mfa: mfaFilter || undefined,
        organization: organization || undefined,
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

  // Toggle user status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      isActive ? usersApi.activate(id) : usersApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t("users.status_updated"), "success");
    },
    onError: (error) => {
      if (!openWorkOf(error)) showToast(t("users.status_update_error"), "error");
    },
  });

  // 邀请重发:一直可点、不弹确认(界面不知道邮件到底发没发出去)。旧链接在被接受或 7 天内仍有效。
  const resendMutation = useMutation({
    mutationFn: (user: User) =>
      usersApi.invite({ email: user.email, role: user.role, username: user.username, ...(user.tenant?.code ? { tenant: user.tenant.code } : {}) }),
    onSuccess: (res, user) => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      showToast(t(res.status === 200 ? "officerInvite.resent_toast" : "officerInvite.sent_toast", { email: user.email }), "success");
    },
    onError: () => showToast(t("users.create_error"), "error"),
  });

  /**
   * 停用前先问一次「他手上有没有在途的事」(交接预览,只读,每次点停用只调一次):有就打开交接对话框的停用模式。
   * 没有、或预览本身失败,直接停用 —— 后端仍会对手上有事的人答 409 `officer_has_open_work`,那时同样打开对话框。
   */
  const requestDeactivate = async (user: User) => {
    if (user.role !== "SOUL" && user.id !== myId) {
      try {
        const { data: preview } = await handoverApi.preview(user.id);
        if (previewTotal(preview) > 0) {
          setDeactivateWith(user);
          return;
        }
      } catch {
        /* 预览不可用 = 交给后端判断 */
      }
    }
    toggleStatusMutation.mutate(
      { id: String(user.id), isActive: false },
      { onError: (error) => openWorkOf(error) && setDeactivateWith(user) },
    );
  };

  const users = data?.results ?? [];
  const selection = useUserSelection(JSON.stringify({ page, search, roleFilter, ordering, located, mfaFilter, organization }), users);

  const allColumns: DataTableColumn[] = [
    { key: "username", header: t("users.username"), sortable: true, pinned: true },
    { key: "email", header: t("users.email"), sortable: true },
    { key: "role", header: t("users.role"), sortable: true },
    { key: "tenant", header: t("users.tenant") },
    { key: "organization", header: t("users.organization_column") },
    { key: "status", header: t("users.status") },
    { key: "mfa", header: t("mfa.admin.column") },
    { key: "actions", header: t("users.actions"), align: "right", srOnlyHeader: true, pinned: true },
  ];
  const columnVis = useColumnVisibility(USERS_COLUMNS_KEY, allColumns);
  const show = (key: string) => columnVis.isVisible(key);

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
      actions={
        <RequirePermission permissions="user.manage">
          {/* 后端导出的是全部用户、不跟列表筛选走,所以不给 `count`(带数的写法会说「按当前筛选导出」)。 */}
          <ExportCsvButton fetchCsv={() => usersApi.export()} page={t("users.title")} hall={hall} />
          <Button type="button" variant="secondary" onClick={() => setIsImportOpen(true)}>
            {t("users.import.button")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setIsInviteOpen(true)}>
            {t("officerInvite.action")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setIsModalOpen(true)}>
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
          {/* 两步验证(A12):三态筛选,`missing` = 角色被要求而没开。 */}
          <FilterChipSelect
            label={t("mfa.admin.column")}
            value={mfaFilter}
            options={[
              { value: "", label: t("mfa.admin.filter_all") },
              { value: "enabled", label: t("mfa.admin.filter_on") },
              { value: "disabled", label: t("mfa.admin.filter_off") },
              { value: "missing", label: t("mfa.admin.filter_missing") },
            ]}
            clearLabel={t("filter.clear_one", { name: t("mfa.admin.column") })}
            onChange={(v) => {
              setMfaFilter(v);
              setPage(1);
            }}
          />
          <ColumnMenu
            className="ml-auto"
            columns={allColumns.map((c) => ({ key: c.key, header: String(c.header), pinned: c.pinned }))}
            visibility={columnVis}
            buttonLabel={t("list.columns.button", { shown: String(columnVis.shown), total: String(columnVis.total) })}
            pinnedLabel={t("list.columns.pinned")}
            hintLabel={t("list.columns.hint")}
            resetLabel={t("list.columns.reset")}
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
        caption={t("users.title")}
        columns={allColumns.filter((c) => show(c.key))}
        data={users}
        selection={canManage ? selection.tableSelection : undefined}
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
                user.username === located && LOCATED_BG
              )}
            >
              {user.username}
            </td>
            {show("email") && <td className={cn("px-4 py-3 text-[oklch(var(--color-ink-muted))]", user.username === located && LOCATED_BG)}>
              {user.email}
            </td>}
            {show("role") && <td className={cn("px-4 py-3", user.username === located && LOCATED_BG)}>
              {/* 规范 v1 §2「徽章 · 只有常态」:无底色,字与 1 px 边同色。角色是身份,
                  不是系统状态,所以不借反馈色 —— 一律中性,名字本身区分。 */}
              <UserRoleChips role={user.role} extraRoles={user.extra_roles} customLabelOf={customRoleLabel} />
            </td>}
            {show("tenant") && <td className={cn("px-4 py-3 text-[oklch(var(--color-ink-muted))]", user.username === located && LOCATED_BG)}>
              {user.tenant?.display_name || user.tenant?.code || "-"}
            </td>}
            {/* 机构与职务只由管理员在编辑弹层里设(`PATCH /users/{id}/`);此前列表上没有,机构页的「查看人员」因此总是空的也没人看得出。 */}
            {show("organization") && <td data-testid="user-organization" className={cn("px-4 py-3 text-[oklch(var(--color-ink-muted))]", user.username === located && LOCATED_BG)}>
              {[user.organization?.name, user.position].filter(Boolean).join(" · ") || "-"}
            </td>}
            {show("status") && <td className={cn("px-4 py-3", user.username === located && LOCATED_BG)}>
              {/* 状态 = 颜色 + 字形(规范 v1 §1.2),不只靠颜色。 */}
              <Badge tone={user.is_active ? "success" : "neutral"} glyph={user.is_active ? "✓" : "○"}>
                {user.is_active ? t("users.active") : t("users.inactive")}
              </Badge>
              {user.is_eval_identity && <EvalIdentityTag />}
              {user.invite_pending ? (
                <span className="ml-2 inline-flex flex-wrap items-center gap-1" data-testid="invite-pending">
                  <Badge tone="neutral" glyph="✉">{t("officerInvite.pending_badge")}</Badge>
                  <RequirePermission permissions="user.manage">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title={t("officerInvite.resend_hint")}
                      data-testid="invite-resend"
                      onClick={() => resendMutation.mutate(user)}
                    >
                      {t("officerInvite.resend")}
                    </Button>
                  </RequirePermission>
                </span>
              ) : null}
            </td>}
            {show("mfa") && <td className={cn("px-4 py-3", user.username === located && LOCATED_BG)}>
              {/* 三态,字形 + 文字(A12):✓ 已开启 + 日期 / ○ 未开启 · 角色不要求 / ! 要求开启 · 未开启。 */}
              {user.mfa ? (
                <MfaCell mfa={user.mfa} />
              ) : null}
            </td>}
            <td className={cn("px-4 py-3 text-right", user.username === located && LOCATED_BG)}>
              <div className="flex items-center justify-end gap-1">
                {user.mfa?.enabled ? (
                  <RequirePermission permissions="user.manage">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setResetMfaUser(user)}>
                      {t("mfa.admin.reset")}
                    </Button>
                  </RequirePermission>
                ) : null}
                {/* 以此人身份查看(W6):只给系统管理员(ADMIN);另一位管理员、自己、停用与灵魂账号的行不出现。 */}
                {isAdmin && user.role !== "ADMIN" && user.role !== "SOUL" && user.is_active && user.id !== myId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="impersonate-open"
                    onClick={() => setImpersonateUser(user)}
                  >
                    {t("admin.users.impersonate")}
                  </Button>
                ) : null}
                <RequirePermission permissions="user.manage">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingUser(user)}>
                    {t("common.edit")}
                  </Button>
                </RequirePermission>
                {/* 自己的密码走「修改密码」:重置会把自己也退出去。 */}
                {user.id !== myId ? (
                  <RequirePermission permissions="user.manage">
                    <Button type="button" size="sm" variant="ghost" data-testid="password-reset-open" onClick={() => setResetPasswordUser(user)}>
                      {t("users.reset_password.action")}
                    </Button>
                  </RequirePermission>
                ) : null}
                {user.role !== "SOUL" && user.is_active ? (
                  <RequirePermission permissions="judgment.assign">
                    <Button type="button" size="sm" variant="ghost" data-testid="handover-open" onClick={() => setHandoverUser(user)}>
                      {t("officerHandover.action")}
                    </Button>
                  </RequirePermission>
                ) : null}
                <RequirePermission permissions="user.manage">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRolesUser(user)}>
                    {t("users.edit_roles")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="user.manage">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => user.is_active
                      ? void requestDeactivate(user)
                      : toggleStatusMutation.mutate({ id: String(user.id), isActive: true })}
                    disabled={toggleStatusMutation.isPending}
                  >
                    {user.is_active ? t("users.deactivate") : t("users.activate")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="user.manage">
                  {/* 幽灵按钮,不上冷玫红:红只给系统出错与「输入名称以确认」里的危险键(规范 v2 A1)。 */}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteUser(user)}>
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
        isFiltered={Boolean(search || roleFilter || located || mfaFilter)}
        onClearFilters={() => {
          setSearch("");
          setRoleFilter("");
          setMfaFilter("");
          setPage(1);
          if (located) router.replace("/users");
        }}
        emptyMessage={t("users.no_users")}
        page={page}
        totalPages={Math.ceil((data?.count || 0) / PAGE_SIZE)}
        totalCount={data?.count}
        onPageChange={setPage}
      />

      {canManage && <UserBatchBar selection={selection} onHeld={setHeld} />}
      {canManage && held.length > 0 && (
        <ul aria-label={t("users.batch.held_region")} className="mt-2 divide-y divide-[oklch(var(--color-block))] border border-[oklch(var(--color-block))]">
          {held.map((h) => {
            const n = previewTotal({ ...h.open_work, problems: [] });
            const row = users.find((u) => String(u.id) === String(h.id));
            return (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1">{t("users.batch.held_row", { name: h.username, n: String(n) })}</span>
                {row ? (
                  <Button type="button" size="sm" onClick={() => { setHeld((rest) => rest.filter((x) => x.id !== h.id)); setDeactivateWith(row); }}>
                    {t("officerHandover.submit_and_deactivate_n", { n: String(n) })}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <UserRolesDialog user={rolesUser} onClose={() => setRolesUser(null)} />

      {/* Create/Edit Modal */}
      <UserImportDialog isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      <OfficerInviteDialog isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} />
      {handoverUser ? <OfficerHandoverDialog from={handoverUser} onClose={() => setHandoverUser(null)} /> : null}
      {deactivateWith ? <OfficerHandoverDialog from={deactivateWith} deactivate onClose={() => setDeactivateWith(null)} /> : null}
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

      {impersonateUser ? <ImpersonateDialog user={impersonateUser} onClose={() => setImpersonateUser(null)} /> : null}
      {resetPasswordUser ? <PasswordResetDialog user={resetPasswordUser} onClose={() => setResetPasswordUser(null)} /> : null}
      {resetMfaUser ? <MfaResetDialog user={resetMfaUser} onClose={() => setResetMfaUser(null)} /> : null}
    </PageShell>
  );
}

/** 用户列表的「两步验证」格:三态。 */
function MfaCell({ mfa }: { mfa: NonNullable<User["mfa"]> }) {
  const { t, formatDate } = useI18n();
  if (mfa.enabled) {
    return (
      <span className="flex flex-wrap items-center gap-2" data-mfa="on">
        <Badge tone="success" glyph="✓">{t("mfa.admin.state_on")}</Badge>
        {mfa.confirmed_at ? (
          <span className="text-xs text-[oklch(var(--color-ink-muted))]">
            {formatDate(mfa.confirmed_at)}
            {mfa.last_used_at ? ` · ${formatDate(mfa.last_used_at)}` : ""}
          </span>
        ) : null}
      </span>
    );
  }
  if (mfa.required) {
    return (
      <Badge tone="warning" glyph="!" data-mfa="missing">
        {t("mfa.admin.state_missing")}
      </Badge>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2" data-mfa="off">
      <Badge tone="neutral" glyph="○">{t("mfa.admin.state_off")}</Badge>
      <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("mfa.admin.state_off_note")}</span>
    </span>
  );
}
