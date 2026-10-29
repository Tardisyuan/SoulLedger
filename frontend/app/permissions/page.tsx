"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { permApi, Permission, Role, RolePermissions } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { useTenant } from "@/src/contexts/TenantContext";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PageSection } from "@/components/ui/page-section";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import { RoleFormModal } from "@/src/components/permissions/RoleFormModal";
import { ColumnMenu, DataGrid, useColumnVisibility } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import {
  cloneGrantMap,
  findCountParadox,
  findNonSubsetPair,
  type GrantMap,
} from "@/src/components/permissions/matrixDiff";
import { MatrixLegend } from "@/src/components/permissions/MatrixLegend";
import { PermissionMatrixTable, PermLegend, type MatrixCellInfo } from "@/src/components/permissions/PermissionMatrixTable";
import { MatrixSaveConfirmModal } from "@/src/components/permissions/MatrixSaveConfirmModal";
import { ImpactConflictBanner, PartialFailBanner, UnsavedBar, conflictCounts } from "@/src/components/permissions/MatrixBanners";
import { PermissionConfigTransfer } from "@/src/components/permissions/PermissionConfigTransfer";
import { RolesSection } from "@/src/components/permissions/RolesSection";
import { DeleteConfirmModal } from "@/src/components/permissions/DeleteConfirmModal";
import { buildPermissionColumns } from "@/src/components/permissions/permissionColumns";
import { usePermissionCrud } from "@/src/components/permissions/usePermissionCrud";
import { useMatrixCells, type CellFailure } from "@/src/components/permissions/useMatrixCells";
import { matrixCellKey } from "@soulledger/core/hooks/usePermissionMatrix";
import { permKeys } from "@soulledger/core/query_keys";
import { fieldControl } from "@/src/components/ui/Field";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { cn } from "@/lib/utils";

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

/** 列菜单的偏好,一个列表一份(定义那一段)。矩阵的「只看差异」不记:它是当次比较的视图,不是列表的常驻筛选。 */
const PERMISSIONS_COLUMNS_KEY = "soulledger.permissions.columns";

export default function PermissionsPage() {
  // 页级门(rbac-web L-1 / L-6):授权矩阵的读接口按 `system.settings` 判(2026-10-29 第 2 条,此前是 IsAdmin);
  // 门在最外层,不持码的人不发 role-permissions/all/。
  return (
    <RequirePermission permissions="system.settings" fallback={<PermissionDenied permission="system.settings" />}>
      <PermissionsPageContent />
    </RequirePermission>
  );
}

function PermissionsPageContent() {
  const { t } = useI18n();
  const { hasPermission, isAdmin } = usePermissions();
  const { user } = useTenant();
  // 写(建 / 改 / 删码与角色、矩阵保存、导入)只给没绑殿的 ADMIN 且持 system.settings —— 与后端
  // `CanWriteGlobalSettings` 同一条件:角色与授权是所有殿共用的配置。别的持码者只读。
  const canManagePermissions = hasPermission("system.settings") && isAdmin && !user?.tenant;

  // ── Permission CRUD state (unchanged from the previous per-role picker) ──
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<Permission | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingPerm, setDeletingPerm] = useState<Permission | null>(null);

  // ── Role CRUD state — edit, copy and recycle live in the role drawer now ──
  const [isRoleCreateOpen, setIsRoleCreateOpen] = useState(false);

  // ── Page segment (E-11: 矩阵 / 角色; the permission definitions keep a third) ──
  const [segment, setSegment] = useState<"matrix" | "roles" | "definitions">("matrix");
  // 393 px: which role's column the row toggles edit.
  const [mobileRole, setMobileRole] = useState("");

  // ── Matrix state ──
  const [filterText, setFilterText] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [checked, setChecked] = useState<GrantMap | null>(null);

  // ── Data fetching ──
  // Full matrix = 1 call for all Permission rows + 1 call for all Role rows
  // (which carries user_count/version) + 1 call for every role's grants
  // (`/perm/role-permissions/all/`). Three calls, whatever the role count —
  // it used to be one call per role (perf review 2026-10-27 #10).
  const permsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await permApi.list()).data,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await permApi.roles.list()).data,
  });

  const roleNames = useMemo(() => (rolesQuery.data ?? []).map((r) => r.name), [rolesQuery.data]);

  // 身份带(A6):题「权限」,右栏「N 角色 · N 项权限」,两个数都等两张表载入后才写。
  const hall = useHall(t("plaque.office.rules"));
  usePlaque({
    title: t("plaque.permissions"),
    hall,
    meta:
      rolesQuery.data && permsQuery.data
        ? t("plaque.permissions_meta", { roles: String(rolesQuery.data.length), perms: String(permsQuery.data.length) })
        : undefined,
  });

  // Keyed by the role names, so a created / copied / renamed role refetches the grants instead of
  // reading as a role with none (FL-05: an empty baseline turns into "remove every grant").
  const grantsQuery = useQuery({
    queryKey: permKeys.allRolePermissionsFor(roleNames),
    queryFn: async () => (await permApi.allRolePermissions()).data,
    enabled: roleNames.length > 0,
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

  const grantsByRole = useMemo(() => {
    const map: Record<string, RolePermissions> = {};
    (grantsQuery.data ?? []).forEach((r) => { map[r.role] = r; });
    return map;
  }, [grantsQuery.data]);
  const rolePermsLoaded = roleNames.length > 0 && roleNames.every((name) => !!grantsByRole[name]);
  const rolePermsError = grantsQuery.isError;
  const matrixReady = !!permsQuery.data && rolePermsLoaded;

  const baseline = useMemo<GrantMap | null>(() => {
    if (!matrixReady) return null;
    const map: GrantMap = {};
    roleNames.forEach((name) => {
      map[name] = new Set(grantsByRole[name].details.map((p) => p.id));
    });
    return map;
  }, [matrixReady, roleNames, grantsByRole]);

  // Populate the editable `checked` state from the loaded baseline once, then
  // keep its KEY SET in step with the baseline's. After a save, individual
  // roles are patched in place (see runSave) rather than re-deriving from
  // `baseline` here, so in-progress edits to OTHER roles are never clobbered
  // by one role's save landing.
  //
  // THE KEY SET HAS TO FOLLOW, AND THIS WAS THE HOLE. `checked` is keyed by
  // role name. Rename a custom role (the backend cascades it, `3ecd5af`) and
  // the roles query comes back with the new name: `baseline` is rebuilt under
  // that key, `checked` still holds the old one, and `checked[newName]` is
  // undefined — which `useMatrixSave` reads as an empty set. The live diff
  // for the renamed role was therefore "remove all N grants", tier 3, and
  // confirming it really stripped the role (FL-05). A role that appears in
  // `baseline` but not in `checked` is seeded from the baseline; one that has
  // left `baseline` is dropped. Roles present in both are left exactly as the
  // operator has them, which is what the once-only rule was protecting.
  // Pinned by `PermissionsPage.roleRename.test.tsx`.
  useEffect(() => {
    if (!baseline) return;
    setChecked((prev) => {
      if (prev === null) return cloneGrantMap(baseline);
      const next: GrantMap = {};
      let changed = false;
      for (const role of Object.keys(baseline)) {
        if (prev[role]) {
          next[role] = prev[role];
        } else {
          next[role] = new Set(baseline[role]);
          changed = true;
        }
      }
      if (Object.keys(prev).some((role) => !(role in baseline))) changed = true;
      return changed ? next : prev;
    });
  }, [baseline]);

  function toggleCell(role: string, permId: number) {
    if (isSaving || !canManagePermissions) return;
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

  const cells = useMatrixCells({ checked, setChecked, baseline, roleNames, permsById, roleMeta });
  const isSaving = cells.isSaving;

  /** Why a cell was not written, in words (the `code` from matrix.py). */
  const failureReason = useCallback(
    (f: CellFailure) =>
      f.code ? t(`permissions.matrix.refused.${f.code}`) : (f.detail ?? t("permissions.matrix.save_error")),
    [t]
  );

  const cellInfo: MatrixCellInfo = {
    granted: (role, permId) => checked?.[role]?.has(permId) ?? false,
    pending: (key) => cells.pendingKeys.has(key),
    failure: cells.failureAt,
    conflict: (key) => cells.conflictCells.has(key),
    failureReason,
    heldCodenames: (role) =>
      new Set([...(checked?.[role] ?? [])].map((id) => permsById[id]?.codename).filter((c): c is string => !!c)),
  };

  /** 定位: bring the failed cell on screen and put focus on it (on 393 px, via its role). */
  function locate(f: CellFailure) {
    setSegment("matrix");
    setMobileRole(f.role);
    requestAnimationFrame(() => {
      const key = matrixCellKey(f.role, f.permissionId);
      const target = [...document.querySelectorAll<HTMLElement>(`[data-cell="${key}"]`)].find(
        (el) => el.offsetParent !== null
      );
      target?.scrollIntoView({ block: "center", inline: "center" });
      target?.focus();
    });
  }

  // ── Permission / Role CRUD mutations (unchanged behavior) ──
  const { createMutation, editMutation, deleteMutation, roleCreateMutation } = usePermissionCrud({
    onCreated: () => setIsCreateOpen(false),
    onEdited: () => { setIsEditOpen(false); setEditingPerm(null); },
    onDeleted: () => { setIsDeleteOpen(false); setDeletingPerm(null); },
    onRoleCreated: () => setIsRoleCreateOpen(false),
    onRoleEdited: () => {},
    onRoleDeleted: () => {},
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

  const columnVis = useColumnVisibility(PERMISSIONS_COLUMNS_KEY, permissionColumns);

  const segments = [
    { value: "matrix" as const, label: t("permissions.segments.matrix") },
    { value: "roles" as const, label: t("permissions.segments.roles"), count: rolesQuery.data?.length },
    { value: "definitions" as const, label: t("permissions.segments.definitions") },
  ];

  return (
    // `full`,不是 `page` —— 矩阵的列数随角色数增长,不设列宽上限。
    <PageShell
      variant="full"
      title={
        <>
          {t("permissions.title")}
          <MenuGloss path="/permissions" />
        </>
      }
      subtitle={t("permissions.subtitle")}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!canManagePermissions ? undefined : segment === "roles" ? (
          <Button type="button" variant="secondary" onClick={() => setIsRoleCreateOpen(true)}>
            + {t("permissions.create_role")}
          </Button>
        ) : segment === "definitions" && !permsQuery.isLoading ? (
          <Button type="button" variant="secondary" onClick={() => setIsCreateOpen(true)}>
            + {t("permissions.create")}
          </Button>
        ) : undefined}
          <PermissionConfigTransfer />
        </div>
      }
      tabs={
        <div role="group" aria-label={t("permissions.segments.label")} className="flex w-fit flex-wrap border border-[oklch(var(--color-block))]">
          {segments.map((s) => {
            const on = segment === s.value;
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={on}
                onClick={() => setSegment(s.value)}
                className={cn(
                  "flex min-h-(--control-h-sm) items-center gap-2 px-3 text-sm",
                  on
                    ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                    : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                )}
              >
                {s.label}
                {s.count !== undefined && <span aria-hidden="true" className="font-mono text-2xs opacity-80">{s.count}</span>}
              </button>
            );
          })}
        </div>
      }
    >
      <>
        {segment === "matrix" && (
          <div className="space-y-4">
            {cells.lastSave && (
              <PartialFailBanner
                saved={cells.lastSave.saved}
                failures={cells.failures}
                roleMeta={roleMeta}
                permsById={permsById}
                reason={failureReason}
                onLocate={locate}
                onDismiss={cells.dismissLastSave}
              />
            )}
            <ImpactConflictBanner
              conflicts={cells.conflicts}
              workflowConflicts={cells.workflowConflicts}
              roleMeta={roleMeta}
              permsById={permsById}
            />

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

              {/* Design A6:筛选框 280 宽 + 「只看差异」,图例靠右在同一行。 */}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder={t("permissions.matrix.filter_placeholder")}
                  aria-label={t("permissions.matrix.filter_placeholder")}
                  className={cn(fieldControl({ size: "sm" }), "min-w-0 flex-1 md:w-[280px] md:flex-none")}
                />
                <FilterChipToggle pressed={onlyDifferences} onPressedChange={setOnlyDifferences}>
                  {t("permissions.matrix.only_differences")}
                </FilterChipToggle>
                <div className="basis-full md:ml-auto md:basis-auto">
                  <PermLegend />
                </div>
              </div>

              <PermissionMatrixTable
                matrixReady={matrixReady}
                roleNames={roleNames}
                roleMeta={roleMeta}
                categories={categories}
                isSaving={isSaving}
                isVisible={(p) => matchesFilter(p) && (!onlyDifferences || rowHasDifference(p))}
                onToggle={toggleCell}
                categoryTally={categoryTally}
                info={cellInfo}
                mobileRole={mobileRole}
                onMobileRoleChange={setMobileRole}
              />
            </PageSection>

            <UnsavedBar
              count={cells.changes.length}
              grants={cells.grants}
              revokes={cells.revokes}
              isSaving={isSaving}
              saveDisabled={cells.saveBlocked}
              conflict={
                cells.conflicts.length + cells.workflowConflicts.length > 0
                  ? {
                      ...conflictCounts(cells.conflicts, cells.workflowConflicts),
                      acknowledged: cells.acknowledged,
                      onAcknowledge: cells.setAcknowledged,
                    }
                  : undefined
              }
              onDiscard={cells.discard}
              onSave={cells.handleSave}
            />
          </div>
        )}

        {segment === "roles" && (
          <RequirePermission permissions="system.settings" fallback={<PermissionDenied />}>
            <RolesSection
              roles={rolesQuery.data ?? []}
              isLoading={rolesQuery.isLoading}
              isError={rolesQuery.isError}
              onRetry={() => rolesQuery.refetch()}
              onOpenMatrix={(role) => {
                setMobileRole(role);
                setSegment("matrix");
              }}
            />
          </RequirePermission>
        )}

        {segment === "definitions" && (
          <>
          {/* 定义这一段没有筛选条:列菜单单独靠右一行(393 宽不出现,见 ColumnMenu)。 */}
          <div className="mb-3 flex justify-end">
            <ColumnMenu
              columns={permissionColumns.map((c) => ({ key: c.key, header: String(c.header), pinned: c.pinned }))}
              visibility={columnVis}
              buttonLabel={t("list.columns.button", { shown: String(columnVis.shown), total: String(columnVis.total) })}
              pinnedLabel={t("list.columns.pinned")}
              hintLabel={t("list.columns.hint")}
              resetLabel={t("list.columns.reset")}
            />
          </div>
          <DataGrid<Permission>
            caption={t("permissions.all_permissions")}
            columns={permissionColumns}
            hiddenColumns={columnVis.hidden}
            data={permsQuery.data ?? []}
            isLoading={permsQuery.isLoading}
            isError={permsQuery.isError}
            keyExtractor={(perm) => String(perm.id)}
          />
          </>
        )}

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
        <DeleteConfirmModal
          isOpen={isDeleteOpen}
          onClose={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
          title={t("permissions.confirm_delete")}
          message={t("permissions.confirm_delete_message")}
          name={deletingPerm?.codename ?? ""}
          isPending={deleteMutation.isPending}
          onConfirm={() => deletingPerm && deleteMutation.mutate(deletingPerm.id)}
        />

        <RoleFormModal
          isOpen={isRoleCreateOpen}
          onClose={() => setIsRoleCreateOpen(false)}
          onSubmit={(data) => roleCreateMutation.mutate(data)}
          isPending={roleCreateMutation.isPending}
          error={roleCreateMutation.isError ? t("permissions.role_create_error") : null}
          title={t("permissions.create_role")}
        />

        {/* ── Tier 2 / tier 3 save confirmation ── */}
        <MatrixSaveConfirmModal
          isOpen={cells.confirmOpen}
          diffs={cells.pendingDiffs}
          roleMeta={roleMeta}
          typedRoleNames={cells.typedRoleNames}
          onTypedRoleNameChange={cells.setTypedRoleName}
          isSaving={isSaving}
          canConfirmSave={cells.canConfirmSave}
          onClose={cells.closeConfirm}
          onCancel={cells.closeConfirm}
          onConfirm={cells.confirmSave}
        />
      </>
    </PageShell>
  );
}
