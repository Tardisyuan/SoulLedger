"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { permApi, Permission, Role, RolePermissions } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin, RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PageSection } from "@/components/ui/page-section";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import { RoleFormModal } from "@/src/components/permissions/RoleFormModal";
import { DataGrid } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import {
  cloneGrantMap,
  findCountParadox,
  findNonSubsetPair,
  type GrantMap,
} from "@/src/components/permissions/matrixDiff";
import { ConflictBanner } from "@/src/components/permissions/ConflictBanner";
import { PartialSaveBanner } from "@/src/components/permissions/PartialSaveBanner";
import { MatrixLegend } from "@/src/components/permissions/MatrixLegend";
import { MatrixToolbar } from "@/src/components/permissions/MatrixToolbar";
import { PermissionMatrixTable } from "@/src/components/permissions/PermissionMatrixTable";
import { MatrixSaveConfirmModal } from "@/src/components/permissions/MatrixSaveConfirmModal";
import { RolesGrid } from "@/src/components/permissions/RolesGrid";
import { DeleteConfirmModal } from "@/src/components/permissions/DeleteConfirmModal";
import { buildPermissionColumns } from "@/src/components/permissions/permissionColumns";
import { usePermissionCrud } from "@/src/components/permissions/usePermissionCrud";
import { useMatrixSave } from "@/src/components/permissions/useMatrixSave";

// The pure diff/tier helpers moved to src/components/permissions/matrixDiff.ts
// when this file was split for the 500-line limit. They stay re-exported from
// here because src/__tests__/PermissionsMatrixDiff.test.ts imports them from
// this path — the split is a refactor, not a change to what this module offers.
export {
  computeRoleDiff,
  cloneGrantMap,
  findNonSubsetPair,
  findCountParadox,
} from "@/src/components/permissions/matrixDiff";
export type { GrantMap, RoleDiff } from "@/src/components/permissions/matrixDiff";

export default function PermissionsPage() {
  const { t } = useI18n();
  const { hasPermission } = usePermissions();
  const canManagePermissions = hasPermission("system.settings");

  // ── Permission CRUD state (unchanged from the previous per-role picker) ──
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<Permission | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingPerm, setDeletingPerm] = useState<Permission | null>(null);

  // ── Role CRUD state ──
  const [isRoleCreateOpen, setIsRoleCreateOpen] = useState(false);
  const [isRoleEditOpen, setIsRoleEditOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isRoleDeleteOpen, setIsRoleDeleteOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  // ── Matrix state ──
  const [filterText, setFilterText] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [checked, setChecked] = useState<GrantMap | null>(null);

  // ── Data fetching ──
  // Full matrix = 1 call for all Permission rows + 1 call for all Role rows
  // (which now carries user_count/version) + one call per role for its
  // current grants (there is no bulk role-permission endpoint — see
  // backend/apps/perm/urls.py). 5 roles today, so 7 calls total on load.
  const permsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await permApi.list()).data,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await permApi.roles.list()).data,
  });

  const roleNames = useMemo(() => (rolesQuery.data ?? []).map((r) => r.name), [rolesQuery.data]);

  const rolePermQueries = useQueries({
    queries: roleNames.map((name) => ({
      queryKey: ["role-permissions", name],
      queryFn: async () => (await permApi.rolePermissions(name)).data,
    })),
  });

  const roleMeta = useMemo(() => {
    const map: Record<string, Role> = {};
    (rolesQuery.data ?? []).forEach((r) => { map[r.name] = r; });
    return map;
  }, [rolesQuery.data]);

  const permsById = useMemo(() => {
    const map: Record<number, Permission> = {};
    (permsQuery.data ?? []).forEach((p) => { map[p.id] = p; });
    return map;
  }, [permsQuery.data]);

  // Categories are whatever the live permission data actually contains,
  // grouped in the order they first appear (Permission.Meta.ordering is
  // ["category", "codename"], so the API already hands them back grouped).
  const categories = useMemo(() => {
    const order: string[] = [];
    const byCategory: Record<string, Permission[]> = {};
    (permsQuery.data ?? []).forEach((p) => {
      if (!byCategory[p.category]) {
        byCategory[p.category] = [];
        order.push(p.category);
      }
      byCategory[p.category].push(p);
    });
    return order.map((category) => ({ category, perms: byCategory[category] }));
  }, [permsQuery.data]);

  const rolePermsLoaded = roleNames.length > 0 && rolePermQueries.every((q) => !!q.data);
  const rolePermsLoading = rolePermQueries.some((q) => q.isLoading);
  const rolePermsError = rolePermQueries.some((q) => q.isError);
  const matrixReady = !!permsQuery.data && rolePermsLoaded;

  // A dependency array must stay the same length across renders — roleNames
  // (and so rolePermQueries) grows from 0 to N once /perm/roles/ resolves,
  // so the query results are folded into one stable string key here rather
  // than spread into the deps array itself.
  const rolePermsUpdatedKey = rolePermQueries.map((q) => q.dataUpdatedAt).join(",");
  const baseline = useMemo<GrantMap | null>(() => {
    if (!matrixReady) return null;
    const map: GrantMap = {};
    roleNames.forEach((name, i) => {
      const data = rolePermQueries[i].data as RolePermissions;
      map[name] = new Set(data.details.map((p) => p.id));
    });
    return map;
    // `rolePermQueries` is deliberately not a dependency. `useQueries` returns
    // a **new array on every render**, so including it would re-run this memo
    // every render and mint a fresh `baseline` object each time — which the
    // effect below takes as a dependency. That effect is guarded by
    // `checked === null` so it would not loop forever, but the memo would stop
    // memoising anything and every role's Set would be rebuilt on each
    // keystroke in the filter box.
    //
    // `rolePermsUpdatedKey` is the stand-in: it folds each query's
    // `dataUpdatedAt` into one string, so the memo re-runs exactly when a
    // role's permission payload actually changes, which is the only thing that
    // array's identity was ever standing for here.
    //
    // `roleNames` is the other name the rule asked for, and it *is* now a real
    // dependency: it is `useMemo`'d on `rolesQuery.data`, so its identity moves
    // only when the role list does. It replaced a `roleNamesKey =
    // roleNames.join(",")` string that existed solely to stand in for it — with
    // the array itself in the deps, that key had no remaining reader.
    //
    // What would remove the suppression: `useQueries` growing a stable-identity
    // result, or this deriving `baseline` from a single fetch of all roles'
    // permissions rather than N parallel ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixReady, roleNames, rolePermsUpdatedKey]);

  // Populate the editable `checked` state from the loaded baseline exactly
  // once. After a save, individual roles are patched in place (see
  // runSave) rather than re-deriving from `baseline` here, so in-progress
  // edits to OTHER roles are never clobbered by one role's save landing.
  useEffect(() => {
    if (baseline && checked === null) {
      setChecked(cloneGrantMap(baseline));
    }
  }, [baseline, checked]);

  function toggleCell(role: string, permId: number) {
    if (isSaving) return;
    setChecked((prev) => {
      if (!prev) return prev;
      const next = cloneGrantMap(prev);
      const set = next[role] ?? new Set<number>();
      if (set.has(permId)) set.delete(permId);
      else set.add(permId);
      next[role] = set;
      return next;
    });
  }

  function matchesFilter(perm: Permission): boolean {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return true;
    return perm.codename.toLowerCase().includes(needle) || perm.name.toLowerCase().includes(needle);
  }

  function rowHasDifference(perm: Permission): boolean {
    if (!checked) return true;
    const states = roleNames.map((role) => checked[role]?.has(perm.id) ?? false);
    return states.some((s) => s !== states[0]);
  }

  function categoryTally(perms: Permission[], role: string): string {
    const total = perms.length;
    const granted = checked ? perms.filter((p) => checked[role]?.has(p.id)).length : 0;
    return `${granted}/${total}`;
  }

  const {
    isSaving,
    conflict,
    savedBeforeFailure,
    dismissPartialSave,
    confirmOpen,
    pendingDiffs,
    typedRoleNames,
    liveDiffs,
    canConfirmSave,
    handleSaveClick,
    resolveConflict,
    setTypedRoleName,
    closeConfirm,
    cancelConfirm,
    confirmSave,
  } = useMatrixSave({ checked, setChecked, baseline, roleNames, permsById, roleMeta });

  const conflictRoleQuery = conflict ? rolePermQueries[roleNames.indexOf(conflict.role)] : undefined;

  // ── Permission / Role CRUD mutations (unchanged behavior) ──
  const {
    createMutation,
    editMutation,
    deleteMutation,
    roleCreateMutation,
    roleEditMutation,
    roleDeleteMutation,
  } = usePermissionCrud({
    onCreated: () => setIsCreateOpen(false),
    onEdited: () => { setIsEditOpen(false); setEditingPerm(null); },
    onDeleted: () => { setIsDeleteOpen(false); setDeletingPerm(null); },
    onRoleCreated: () => setIsRoleCreateOpen(false),
    onRoleEdited: () => { setIsRoleEditOpen(false); setEditingRole(null); },
    onRoleDeleted: () => { setIsRoleDeleteOpen(false); setDeletingRole(null); },
  });

  // ── Peer-not-ladder legend, computed from the live baseline ──
  const nonSubsetPair = baseline ? findNonSubsetPair(baseline, roleNames) : null;
  const countParadox = baseline ? findCountParadox(baseline, roleNames) : null;

  const permissionColumns = buildPermissionColumns({
    t,
    canManagePermissions,
    onEdit: (perm) => { setEditingPerm(perm); setIsEditOpen(true); },
    onDelete: (perm) => { setDeletingPerm(perm); setIsDeleteOpen(true); },
  });

  return (
    // `full`,不是 `page` —— 这一页的主体是角色 × 权限矩阵,**列数随角色数
    // 增长**。迁移前它被 `max-w-6xl`(1152px)夹着:今天 5 个角色还算宽裕,
    // 第 8 个角色进来时列宽就开始被压。1200px 的 `page` 只是把同一个天花板
    // 抬高 48px,并没有换掉那个天花板。副标题仍然收在 `max-w-prose` 里
    // (PageShell 自己给的),所以「不设列宽」不会让那一句铺满 1800px。
    <PageShell
      variant="full"
      title={
        <>
          {t("permissions.title")}
          <MenuGloss path="/permissions" />
        </>
      }
      // 原先这一句是 `hidden sm:block` —— 在手机上整句消失。它解释的是这一页
      // 在做什么,而手机正是最需要那句解释的地方。
      subtitle={t("permissions.subtitle")}
    >
      <RequireAdmin fallback={<PermissionDenied />}>
        <div className="space-y-10">
          {/* ── 已落库但没说出来的那几个 ──
              放在冲突横幅**之前**:先说已经发生了什么,再说什么没成。
              两者可以同时在场 —— 第 k 个撞 409 时,前 k-1 个正是已落库的。 */}
          {savedBeforeFailure.length > 0 && (
            <PartialSaveBanner saved={savedBeforeFailure} onDismiss={dismissPartialSave} />
          )}

          {/* ── Conflict banner ── */}
          {conflict && (
            <ConflictBanner
              conflict={conflict}
              roleMeta={roleMeta}
              isReloading={conflictRoleQuery?.isFetching}
              onReload={resolveConflict}
            />
          )}

          {/* ── Matrix ── */}
          <PageSection
            title={t("permissions.matrix.title")}
            error={permsQuery.isError || rolesQuery.isError || rolePermsError ? t("permissions.matrix.load_error") : undefined}
          >
            <MatrixLegend
              nonSubsetPair={nonSubsetPair}
              countParadox={countParadox}
              roleMeta={roleMeta}
              permsById={permsById}
            />

            <MatrixToolbar
              filterText={filterText}
              onFilterTextChange={setFilterText}
              onlyDifferences={onlyDifferences}
              onOnlyDifferencesChange={setOnlyDifferences}
              pendingCount={liveDiffs.length}
              onSave={handleSaveClick}
              saveDisabled={liveDiffs.length === 0 || isSaving || !matrixReady}
              isSaving={isSaving}
            />

            <PermissionMatrixTable
              matrixReady={matrixReady}
              roleNames={roleNames}
              roleMeta={roleMeta}
              categories={categories}
              allPerms={permsQuery.data ?? []}
              checked={checked}
              isSaving={isSaving}
              isVisible={(p) => matchesFilter(p) && (!onlyDifferences || rowHasDifference(p))}
              onToggle={toggleCell}
              categoryTally={categoryTally}
            />
          </PageSection>

          {/* ── All Permissions CRUD ── */}
          <PageSection
            title={t("permissions.all_permissions")}
            actions={
              !permsQuery.isLoading ? (
                <RequirePermission permissions="system.settings">
                  <Button type="button" variant="primary" onClick={() => setIsCreateOpen(true)}>
                    + {t("permissions.create")}
                  </Button>
                </RequirePermission>
              ) : undefined
            }
          >
            <DataGrid<Permission>
              caption={t("permissions.all_permissions")}
              columns={permissionColumns}
              data={permsQuery.data ?? []}
              isLoading={permsQuery.isLoading}
              isError={permsQuery.isError}
              keyExtractor={(perm) => String(perm.id)}
            />
          </PageSection>

          {/* ── Roles CRUD ── */}
          <RequirePermission permissions="system.settings">
            <PageSection
              title={t("permissions.roles_title")}
              actions={
                !rolesQuery.isLoading ? (
                  <Button type="button" variant="primary" onClick={() => setIsRoleCreateOpen(true)}>
                    + {t("permissions.create_role")}
                  </Button>
                ) : undefined
              }
            >
              <RolesGrid
                roles={rolesQuery.data ?? []}
                isLoading={rolesQuery.isLoading}
                onEdit={(role) => { setEditingRole(role); setIsRoleEditOpen(true); }}
                onDelete={(role) => { setDeletingRole(role); setIsRoleDeleteOpen(true); }}
              />
            </PageSection>
          </RequirePermission>
        </div>

        {/* ── Create/Edit Permission Modals ── */}
        <PermissionFormModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
          error={createMutation.isError ? t("permissions.create_error") : null}
          title={t("permissions.create")}
          existingCategories={categories.map((c) => c.category)}
        />
        <PermissionFormModal
          isOpen={isEditOpen}
          onClose={() => { setIsEditOpen(false); setEditingPerm(null); }}
          onSubmit={(data) => editingPerm && editMutation.mutate({ id: editingPerm.id, data })}
          isPending={editMutation.isPending}
          error={editMutation.isError ? t("permissions.edit_error") : null}
          title={t("permissions.edit")}
          initialData={editingPerm ?? undefined}
          existingCategories={categories.map((c) => c.category)}
        />

        {/* ── Delete Permission Modal ── */}
        <DeleteConfirmModal
          isOpen={isDeleteOpen}
          onClose={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
          title={t("permissions.confirm_delete")}
          message={t("permissions.confirm_delete_message")}
          isPending={deleteMutation.isPending}
          onConfirm={() => deletingPerm && deleteMutation.mutate(deletingPerm.id)}
        />

        {/* ── Role Modals ── */}
        <RoleFormModal
          isOpen={isRoleCreateOpen}
          onClose={() => setIsRoleCreateOpen(false)}
          onSubmit={(data) => roleCreateMutation.mutate(data)}
          isPending={roleCreateMutation.isPending}
          error={roleCreateMutation.isError ? t("permissions.role_create_error") : null}
          title={t("permissions.create_role")}
        />
        <RoleFormModal
          isOpen={isRoleEditOpen}
          onClose={() => { setIsRoleEditOpen(false); setEditingRole(null); }}
          onSubmit={(data) => editingRole && roleEditMutation.mutate({ id: editingRole.id, data })}
          isPending={roleEditMutation.isPending}
          error={roleEditMutation.isError ? t("permissions.role_edit_error") : null}
          title={t("permissions.edit_role")}
          initialData={editingRole ?? undefined}
        />
        <DeleteConfirmModal
          isOpen={isRoleDeleteOpen}
          onClose={() => { setIsRoleDeleteOpen(false); setDeletingRole(null); }}
          title={t("permissions.confirm_delete_role")}
          message={t("permissions.confirm_delete_role_message")}
          isPending={roleDeleteMutation.isPending}
          onConfirm={() => deletingRole && roleDeleteMutation.mutate(deletingRole.id)}
        />

        {/* ── Three-tier save confirmation (tier 2 and tier 3 diffs) ── */}
        <MatrixSaveConfirmModal
          isOpen={confirmOpen}
          diffs={pendingDiffs}
          roleMeta={roleMeta}
          typedRoleNames={typedRoleNames}
          onTypedRoleNameChange={setTypedRoleName}
          isSaving={isSaving}
          canConfirmSave={canConfirmSave}
          onClose={closeConfirm}
          onCancel={cancelConfirm}
          onConfirm={confirmSave}
        />
      </RequireAdmin>
    </PageShell>
  );
}
