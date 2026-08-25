"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { permApi, Permission, Role, RolePermissions, RolePermissionConflict } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Skeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import { RoleFormModal } from "@/src/components/permissions/RoleFormModal";
import { DataGrid, type DataGridColumn } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers — no React/DOM dependency, exported so
// src/__tests__/PermissionsMatrixDiff.test.ts can exercise the three-tier
// save guard directly instead of through a fully mounted page.
// ─────────────────────────────────────────────────────────────────────────

/** roleName -> set of granted permission ids. */
export type GrantMap = Record<string, Set<number>>;

export interface RoleDiff {
  role: string;
  addedIds: number[];
  removedIds: number[];
  addedCodenames: string[];
  removedCodenames: string[];
  beforeCount: number;
  afterCount: number;
  /** 1 = pure addition, 2 = removal but not to zero, 3 = clears every codename this role holds. */
  tier: 1 | 2 | 3;
  removesMenuRead: boolean;
}

function codenameOf(permsById: Record<number, Permission>, id: number): string {
  return permsById[id]?.codename ?? String(id);
}

/**
 * Diffs one role's in-progress checked selection against its loaded
 * baseline. Returns null when nothing changed — callers filter those out so
 * an untouched role never shows up in a save confirmation.
 *
 * assign_role_permissions replaces a role's ENTIRE grant set on every call,
 * so this is the only thing standing between a stray click and silently
 * wiping a role. Tier boundaries, spelled out because they're the likeliest
 * place for an off-by-one (see PermissionsMatrixDiff.test.ts):
 *   - tier 1 requires removedIds to be EMPTY, not "small" — one removal
 *     alongside ten additions is still a removal, not a pure addition.
 *   - tier 3 requires the AFTER set to be empty, not "removedIds equals
 *     beforeIds" — unchecking every currently-granted box while also
 *     checking one brand-new box still clears the role to a set of size
 *     zero relative to nothing... no: it leaves size 1, which is tier 2, not
 *     3. Zero remaining after the edit is what tier 3 tests for, exactly
 *     because that's the case the typed-confirmation gate exists for.
 */
export function computeRoleDiff(
  role: string,
  before: Set<number>,
  after: Set<number>,
  permsById: Record<number, Permission>
): RoleDiff | null {
  const addedIds = [...after].filter((id) => !before.has(id));
  const removedIds = [...before].filter((id) => !after.has(id));
  if (addedIds.length === 0 && removedIds.length === 0) return null;

  const tier: 1 | 2 | 3 = removedIds.length === 0 ? 1 : after.size === 0 ? 3 : 2;
  const removedCodenames = removedIds.map((id) => codenameOf(permsById, id)).sort();

  return {
    role,
    addedIds,
    removedIds,
    addedCodenames: addedIds.map((id) => codenameOf(permsById, id)).sort(),
    removedCodenames,
    beforeCount: before.size,
    afterCount: after.size,
    tier,
    removesMenuRead: removedCodenames.includes("menu.read"),
  };
}

export function cloneGrantMap(map: GrantMap): GrantMap {
  const out: GrantMap = {};
  for (const [role, ids] of Object.entries(map)) out[role] = new Set(ids);
  return out;
}

/**
 * Finds a pair of roles where neither's grant set contains the other's —
 * live proof that the roles are peers, not a ladder. ADMIN is excluded: by
 * design it is a superset of everyone, so pairing it in would only ever
 * surface the uninteresting "ADMIN also has X" case. Real data, no
 * hardcoded role names or codenames.
 */
export function findNonSubsetPair(
  grants: GrantMap,
  roleNames: string[]
): { a: string; b: string; aOnly: number[]; bOnly: number[] } | null {
  const names = roleNames.filter((r) => r !== "ADMIN");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const setA = grants[a] ?? new Set<number>();
      const setB = grants[b] ?? new Set<number>();
      const aOnly = [...setA].filter((id) => !setB.has(id));
      const bOnly = [...setB].filter((id) => !setA.has(id));
      if (aOnly.length > 0 && bOnly.length > 0) {
        return { a, b, aOnly, bOnly };
      }
    }
  }
  return null;
}

/**
 * Finds the most dramatic real example of "holds more codenames overall"
 * not implying "holds a superset" or "outranks": `higher` has strictly more
 * total grants than `lower`, yet `lower` holds at least one codename
 * `higher` doesn't. Picks the largest count gap among valid pairs so the
 * callout leads with the strongest proof available in the live data.
 */
export function findCountParadox(
  grants: GrantMap,
  roleNames: string[]
): { higher: string; higherCount: number; lower: string; lowerCount: number; exclusiveToLower: number[] } | null {
  const names = roleNames.filter((r) => r !== "ADMIN");
  let best: { higher: string; higherCount: number; lower: string; lowerCount: number; exclusiveToLower: number[] } | null = null;
  for (const higher of names) {
    for (const lower of names) {
      if (higher === lower) continue;
      const higherSet = grants[higher] ?? new Set<number>();
      const lowerSet = grants[lower] ?? new Set<number>();
      if (higherSet.size <= lowerSet.size) continue;
      const exclusiveToLower = [...lowerSet].filter((id) => !higherSet.has(id));
      if (exclusiveToLower.length === 0) continue;
      const gap = higherSet.size - lowerSet.size;
      if (!best || gap > best.higherCount - best.lowerCount) {
        best = { higher, higherCount: higherSet.size, lower, lowerCount: lowerSet.size, exclusiveToLower };
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────
// Cell — shape, not weight: a filled check glyph vs a literally empty cell.
// No dot, no dash, no dim icon for "not granted" — that reads as "40 dim
// dots" across a wide matrix instead of a sparse, readable set.
// ─────────────────────────────────────────────────────────────────────────

function MatrixCell({
  granted,
  disabled,
  label,
  onToggle,
}: {
  granted: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={granted}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      // 这里原先是 `focus:outline-none focus-visible:ring-2
      // focus-visible:ring-[hsl(var(--color-accent))]` —— 全仓唯一一处把焦点环
      // 指向 --color-accent 的地方,而那正是 globals.css 用 40 行(:96-134)
      // 论证**不能**做的事:--color-accent 被 SettingsDrawer 的 useAccentColor
      // 以**内联样式**写在 document.documentElement 上,取值是用户在抽屉里随手
      // 挑的六位十六进制。内联样式压过样式表里的一切,所以一个挑了浅琥珀的用户
      // 会静默删掉自己**唯一**的键盘焦点指示器,而且无从察觉。第二条独立理由是
      // 它本身就不合格:hsl(38 92% 50%) 在浅色模式白底上是 2.14:1,连非文字
      // UI 的 3:1 底线都够不到。
      //
      // 两条 `outline-none` 也一起删了 —— 它们是全局规则要越过的那 69 处之一。
      // 删掉之后接管的是 globals.css:459 那条
      // `:focus-visible { outline: 2px solid hsl(var(--color-focus)) !important }`,
      // --color-focus 是字面量三元组(深 258 95% 76% / 浅 258 85% 48%),抽屉
      // 够不着它。本组件不写 outline-none,就是它参与全局焦点环的全部要求
      // (Button.tsx 的「FOCUS: deliberately not here」一节说的是同一件事)。
      className={`flex items-center justify-center w-full h-8 transition-colors ${
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[hsl(var(--color-surface-3))]"
      }`}
    >
      {granted ? (
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-[hsl(var(--color-accent-ink))]" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 01.006 1.415l-7.4 7.5a1 1 0 01-1.42.005l-3.6-3.6a1 1 0 111.414-1.414l2.897 2.897 6.69-6.782a1 1 0 011.413-.021z"
            clipRule="evenodd"
          />
        </svg>
      ) : null}
    </button>
  );
}

export default function PermissionsPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<RoleDiff[]>([]);
  const [typedRoleNames, setTypedRoleNames] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState<{ role: string; expected: number; current: number } | null>(null);

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
  const roleNamesKey = roleNames.join(",");
  const baseline = useMemo<GrantMap | null>(() => {
    if (!matrixReady) return null;
    const map: GrantMap = {};
    roleNames.forEach((name, i) => {
      const data = rolePermQueries[i].data as RolePermissions;
      map[name] = new Set(data.details.map((p) => p.id));
    });
    return map;
  }, [matrixReady, roleNamesKey, rolePermsUpdatedKey]);

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

  const liveDiffs: RoleDiff[] =
    checked && baseline
      ? roleNames
          .map((role) => computeRoleDiff(role, baseline[role] ?? new Set(), checked[role] ?? new Set(), permsById))
          .filter((d): d is RoleDiff => d !== null)
      : [];

  function handleSaveClick() {
    if (liveDiffs.length === 0) return;
    const maxTier = Math.max(...liveDiffs.map((d) => d.tier));
    if (maxTier === 1) {
      void runSave(liveDiffs);
    } else {
      setPendingDiffs(liveDiffs);
      setTypedRoleNames({});
      setConfirmOpen(true);
    }
  }

  async function runSave(diffs: RoleDiff[]) {
    if (!checked) return;
    setIsSaving(true);
    setConflict(null);
    const summaries: string[] = [];

    for (const diff of diffs) {
      const afterIds = [...(checked[diff.role] ?? new Set<number>())];
      const expectedVersion = roleMeta[diff.role]?.version;
      try {
        const res = await permApi.assign(diff.role, afterIds, expectedVersion);
        const data = res.data;
        queryClient.setQueryData<Role[]>(["roles"], (old) =>
          old?.map((r) => (r.name === diff.role ? { ...r, version: data.version } : r))
        );
        queryClient.setQueryData<RolePermissions>(["role-permissions", diff.role], (old) =>
          old
            ? {
                ...old,
                details: afterIds.map((id) => permsById[id]).filter((p): p is Permission => !!p),
                permissions: afterIds
                  .map((id) => permsById[id]?.codename)
                  .filter((c): c is string => !!c),
              }
            : old
        );
        summaries.push(
          t("permissions.matrix.before_after_line", {
            role: roleMeta[diff.role]?.display_name || diff.role,
            before: String(diff.beforeCount),
            after: String(diff.afterCount),
          })
        );
      } catch (err) {
        const response = (err as { response?: { status?: number; data?: RolePermissionConflict } }).response;
        if (response?.status === 409) {
          setConflict({
            role: diff.role,
            expected: response.data?.expected_version ?? expectedVersion ?? -1,
            current: response.data?.current_version ?? -1,
          });
          queryClient.invalidateQueries({ queryKey: ["role-permissions", diff.role] });
          queryClient.invalidateQueries({ queryKey: ["roles"] });
          showToast(t("permissions.matrix.conflict_toast", { role: diff.role }), "error");
        } else {
          showToast(t("permissions.matrix.save_error"), "error");
        }
        setIsSaving(false);
        setConfirmOpen(false);
        return;
      }
    }

    setIsSaving(false);
    setConfirmOpen(false);
    setPendingDiffs([]);
    if (summaries.length > 0) showToast(summaries.join("   ·   "), "success");
  }

  function resolveConflict() {
    if (!conflict || !baseline) return;
    setChecked((prev) => {
      if (!prev) return prev;
      const next = cloneGrantMap(prev);
      next[conflict.role] = new Set(baseline[conflict.role] ?? []);
      return next;
    });
    setConflict(null);
  }

  const conflictRoleQuery = conflict ? rolePermQueries[roleNames.indexOf(conflict.role)] : undefined;

  // ── Permission CRUD mutations (unchanged behavior) ──
  const createMutation = useMutation({
    mutationFn: (data: { codename: string; name: string; category: string }) => permApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      setIsCreateOpen(false);
    },
    onError: () => showToast(t("permissions.create_error") || "Failed to create permission", "error"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { codename: string; name: string; category: string } }) =>
      permApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      setIsEditOpen(false);
      setEditingPerm(null);
    },
    onError: () => showToast(t("permissions.edit_error") || "Failed to update permission", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => permApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      setIsDeleteOpen(false);
      setDeletingPerm(null);
    },
    onError: () => showToast(t("permissions.delete_error") || "Failed to delete permission", "error"),
  });

  // ── Role CRUD mutations ──
  const roleCreateMutation = useMutation({
    mutationFn: (data: { name: string; display_name: string }) => permApi.roles.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setIsRoleCreateOpen(false);
    },
    onError: () => showToast(t("permissions.role_create_error") || "Failed to create role", "error"),
  });

  const roleEditMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; display_name: string } }) =>
      permApi.roles.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setIsRoleEditOpen(false);
      setEditingRole(null);
    },
    onError: () => showToast(t("permissions.role_edit_error") || "Failed to update role", "error"),
  });

  const roleDeleteMutation = useMutation({
    mutationFn: (id: number) => permApi.roles.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setIsRoleDeleteOpen(false);
      setDeletingRole(null);
    },
    onError: () => showToast(t("permissions.role_delete_error") || "Failed to delete role", "error"),
  });

  // ── Peer-not-ladder legend, computed from the live baseline ──
  const nonSubsetPair = baseline ? findNonSubsetPair(baseline, roleNames) : null;
  const countParadox = baseline ? findCountParadox(baseline, roleNames) : null;

  const tier3Diffs = pendingDiffs.filter((d) => d.tier === 3);
  const canConfirmSave = tier3Diffs.every((d) => (typedRoleNames[d.role] ?? "").trim() === d.role);

  // Codename/name/category are identifier/text/enum per §1's taxonomy; the
  // actions column collapses to the overflow spec (design doc open item #3)
  // instead of the two bare "编辑/删除" links that used to run together with
  // no separator.
  const permissionColumns: DataGridColumn<Permission>[] = [
    { type: "identifier", key: "codename", header: t("permissions.codename"), width: "220px", value: (perm) => perm.codename },
    { type: "text", key: "name", header: t("permissions.name"), value: (perm) => perm.name },
    {
      type: "enum",
      key: "category",
      header: t("permissions.category"),
      width: "160px",
      value: (perm) => ({ tone: "neutral", label: perm.category }),
    },
    {
      type: "actions",
      key: "actions",
      header: t("souls.action"),
      width: "112px",
      menuLabel: t("common.row_actions"),
      // Edit inline as the one primary verb; delete stays behind the
      // overflow trigger, separated from the safe action — §3's resolution
      // to "两个动作链接连在一起，其中一个是破坏性的".
      primary: (perm) =>
        canManagePermissions ? { label: t("permissions.edit"), onSelect: () => { setEditingPerm(perm); setIsEditOpen(true); } } : null,
      items: (perm) =>
        canManagePermissions
          ? [
              {
                key: "delete",
                label: t("permissions.delete"),
                tone: "danger",
                onSelect: () => { setDeletingPerm(perm); setIsDeleteOpen(true); },
              },
            ]
          : [],
    },
  ];

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
      <RequirePermission permissions="ADMIN" fallback={<PermissionDenied />}>
        <div className="space-y-10">
          {/* ── Conflict banner ── */}
          {conflict && (
            <div role="alert" className="bg-[hsl(var(--color-status-error))]/10 border border-[hsl(var(--color-status-error))]/40 p-4 flex items-center justify-between gap-4">
              <p className="text-03 text-[hsl(var(--color-status-error))]">
                {t("permissions.matrix.conflict_message", {
                  role: roleMeta[conflict.role]?.display_name || conflict.role,
                  expected: String(conflict.expected),
                  current: String(conflict.current),
                })}
              </p>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={resolveConflict}
                disabled={conflictRoleQuery?.isFetching}
                className="shrink-0"
              >
                {conflictRoleQuery?.isFetching ? t("permissions.matrix.conflict_reloading") : t("permissions.matrix.conflict_reload_button")}
              </Button>
            </div>
          )}

          {/* ── Matrix ── */}
          <PageSection
            title={t("permissions.matrix.title")}
            isLoading={permsQuery.isLoading || rolesQuery.isLoading}
            error={permsQuery.isError || rolesQuery.isError || rolePermsError ? t("permissions.matrix.load_error") : undefined}
          >
            {(nonSubsetPair || countParadox) && (
              <div className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] p-4 mb-4 text-03 space-y-2">
                <h3 className="font-semibold text-[hsl(var(--color-ink))]">{t("permissions.matrix.legend_title")}</h3>
                <p className="text-[hsl(var(--color-ink-muted))]">{t("permissions.matrix.legend_intro")}</p>
                {nonSubsetPair && (
                  <p className="text-[hsl(var(--color-ink-muted))]">
                    {t("permissions.matrix.legend_nonsubset", {
                      roleA: roleMeta[nonSubsetPair.a]?.display_name || nonSubsetPair.a,
                      roleB: roleMeta[nonSubsetPair.b]?.display_name || nonSubsetPair.b,
                      codenamesA: nonSubsetPair.aOnly.map((id) => codenameOf(permsById, id)).slice(0, 4).join(", "),
                      codenamesB: nonSubsetPair.bOnly.map((id) => codenameOf(permsById, id)).slice(0, 4).join(", "),
                    })}
                  </p>
                )}
                {countParadox && (
                  <p className="text-[hsl(var(--color-ink-muted))]">
                    {t("permissions.matrix.legend_countparadox", {
                      higher: roleMeta[countParadox.higher]?.display_name || countParadox.higher,
                      higherCount: String(countParadox.higherCount),
                      lower: roleMeta[countParadox.lower]?.display_name || countParadox.lower,
                      lowerCount: String(countParadox.lowerCount),
                      codenames: countParadox.exclusiveToLower.map((id) => codenameOf(permsById, id)).join(", "),
                    })}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={t("permissions.matrix.filter_placeholder")}
                aria-label={t("permissions.matrix.filter_placeholder")}
                className="flex-1 min-w-[200px] px-3 py-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
              <label className="flex items-center gap-2 text-03 text-[hsl(var(--color-ink-muted))] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyDifferences}
                  onChange={(e) => setOnlyDifferences(e.target.checked)}
                  className="accent-[hsl(var(--color-accent))]"
                />
                {t("permissions.matrix.only_differences")}
              </label>
              <div className="flex-1" />
              <span className="text-02 text-[hsl(var(--color-ink-subtle))]">
                {liveDiffs.length > 0
                  ? t("permissions.matrix.pending_count", { count: String(liveDiffs.length) })
                  : t("permissions.matrix.no_changes")}
              </span>
              <Button
                type="button"
                variant="primary"
                onClick={handleSaveClick}
                disabled={liveDiffs.length === 0 || isSaving || !matrixReady}
              >
                {isSaving ? t("permissions.matrix.saving") : t("permissions.matrix.save_button")}
              </Button>
            </div>

            {!matrixReady ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : roleNames.length === 0 ? (
              <p className="text-03 text-[hsl(var(--color-ink-muted))]">{t("permissions.matrix.no_roles")}</p>
            ) : (
              /* 窄屏上真正坏掉的东西,和它不是什么。
                 
                 **原先那句 `overflow-y-auto` 已经能横向滚。** CSS Overflow 3
                 规定:overflow-x/y 之一不是 visible 而另一个是 visible 时,
                 visible 计算成 auto。所以 `overflow-y: auto` 会把 overflow-x
                 一并算成 auto。实测(Playwright + Chromium,把这张表的结构
                 照搬成静态页):`overflow-y:auto` 与 `overflow-x:auto;
                 overflow-y:auto` 两个容器的 computed overflow-x 都是 "auto",
                 scrollWidth 都是 1128 / clientWidth 400,把 scrollLeft 设成
                 999 之后两边都停在 728。右边的角色一直够得到。

                 坏的是**够到之后不知道自己在看哪一行**:第一列跟着一起滚走,
                 于是滚到第 8 个角色时,那一列勾选框对应的是哪条 codename 没有
                 任何东西还在说。所以修法不是加一个已经生效的 `overflow-x-auto`,
                 是把第一列冻住。

                 sticky 从 `<tr>` 挪到了单元格:sticky 元素各自开一个层叠上下文,
                 挂在 <tr> 上时表头行、分类行、正文行是三个互不比较 z-index 的
                 上下文,冻结列的角单元格无法可靠地压在表头之上。挂在单元格上时
                 它们是同一个上下文里的兄弟,z-40 / z-30 / z-20 / z-10 直接可比。
                 表格也从 border-collapse 换成 border-separate + border-spacing-0:
                 collapse 下边框归表格而不归单元格,sticky 单元格滚动时边框会
                 留在原地。 */
              <div className="overflow-auto max-h-[65vh] border border-[hsl(var(--color-hairline))]">
                <table className="w-full border-separate border-spacing-0 text-03">
                  <thead>
                    <tr className="h-11">
                      <th className="sticky top-0 left-0 z-40 bg-[hsl(var(--color-surface-1))] border-b border-[hsl(var(--color-hairline))] text-left px-3 font-medium text-[hsl(var(--color-ink-muted))] min-w-[200px]">
                        {t("permissions.matrix.codename_col")}
                      </th>
                      {roleNames.map((role) => (
                        <th key={role} className="sticky top-0 z-30 bg-[hsl(var(--color-surface-1))] border-b border-[hsl(var(--color-hairline))] px-2 font-medium text-[hsl(var(--color-ink))] min-w-[110px] text-center">
                          <div>{roleMeta[role]?.display_name || role}</div>
                          <div className="text-02 font-normal text-[hsl(var(--color-ink-subtle))] font-mono">
                            {categoryTally(permsQuery.data ?? [], role)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map(({ category, perms }) => {
                      const visiblePerms = perms.filter(
                        (p) => matchesFilter(p) && (!onlyDifferences || rowHasDifference(p))
                      );
                      if (visiblePerms.length === 0) return null;
                      return (
                        <FragmentCategory
                          key={category}
                          category={category}
                          perms={perms}
                          visiblePerms={visiblePerms}
                          roleNames={roleNames}
                          checked={checked}
                          isSaving={isSaving}
                          onToggle={toggleCell}
                          categoryTally={categoryTally}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </PageSection>

          {/* ── All Permissions CRUD ── */}
          <PageSection
            title={t("permissions.all_permissions")}
            isLoading={permsQuery.isLoading}
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
              isLoading={rolesQuery.isLoading}
              actions={
                !rolesQuery.isLoading ? (
                  <Button type="button" variant="primary" onClick={() => setIsRoleCreateOpen(true)}>
                    + {t("permissions.create_role")}
                  </Button>
                ) : undefined
              }
            >
              {rolesQuery.isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
                      <Skeleton className="h-4 w-2/3 mb-2" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {(rolesQuery.data ?? []).map((role) => (
                    <div key={role.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-3 hover:border-[hsl(var(--color-accent))]/30 transition-colors">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-[hsl(var(--color-ink))] truncate text-03">{role.display_name || role.name}</h3>
                        <p className="text-02 text-[hsl(var(--color-ink-muted))] font-mono truncate">{role.name}</p>
                        <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">{t("permissions.matrix.role_users", { count: String(role.user_count) })}</p>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => { setEditingRole(role); setIsRoleEditOpen(true); }}
                          className="flex-1"
                        >
                          {t("permissions.edit_role")}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => { setDeletingRole(role); setIsRoleDeleteOpen(true); }}
                          className="flex-1"
                        >
                          {t("permissions.delete_role")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
        <BaseModal
          isOpen={isDeleteOpen}
          onClose={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
          title={t("permissions.confirm_delete")}
          footer={
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
                disabled={deleteMutation.isPending}
                className="flex-1"
              >
                {t("permissions.cancel_delete")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => deletingPerm && deleteMutation.mutate(deletingPerm.id)}
                disabled={deleteMutation.isPending}
                className="flex-1"
              >
                {deleteMutation.isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
              </Button>
            </div>
          }
        >
          <p className="text-[hsl(var(--color-ink))] text-03">{t("permissions.confirm_delete_message")}</p>
        </BaseModal>

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
        <BaseModal
          isOpen={isRoleDeleteOpen}
          onClose={() => { setIsRoleDeleteOpen(false); setDeletingRole(null); }}
          title={t("permissions.confirm_delete_role")}
          footer={
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setIsRoleDeleteOpen(false); setDeletingRole(null); }}
                disabled={roleDeleteMutation.isPending}
                className="flex-1"
              >
                {t("permissions.cancel_delete")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => deletingRole && roleDeleteMutation.mutate(deletingRole.id)}
                disabled={roleDeleteMutation.isPending}
                className="flex-1"
              >
                {roleDeleteMutation.isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
              </Button>
            </div>
          }
        >
          <p className="text-[hsl(var(--color-ink))] text-03">{t("permissions.confirm_delete_role_message")}</p>
        </BaseModal>

        {/* ── Three-tier save confirmation (tier 2 and tier 3 diffs) ── */}
        <BaseModal
          isOpen={confirmOpen}
          onClose={() => { if (!isSaving) { setConfirmOpen(false); setPendingDiffs([]); } }}
          title={t("permissions.matrix.confirm_title")}
          footer={
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setConfirmOpen(false); setPendingDiffs([]); }}
                disabled={isSaving}
                className="flex-1"
              >
                {t("permissions.matrix.confirm_cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void runSave(pendingDiffs)}
                disabled={isSaving || !canConfirmSave}
                className="flex-1"
              >
                {isSaving ? t("permissions.matrix.confirm_submitting") : t("permissions.matrix.confirm_submit")}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-03 text-[hsl(var(--color-status-warning))]">{t("permissions.matrix.confirm_replace_notice")}</p>
            {pendingDiffs.map((diff) => (
              <div key={diff.role} className="border border-[hsl(var(--color-hairline))] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-[hsl(var(--color-ink))] text-03">{roleMeta[diff.role]?.display_name || diff.role}</h4>
                  <span className="text-02 font-mono text-[hsl(var(--color-ink-muted))]">{diff.beforeCount} → {diff.afterCount}</span>
                </div>
                {diff.tier >= 2 && (
                  <p className="text-02 text-[hsl(var(--color-ink-muted))]">
                    {t("permissions.matrix.confirm_user_count", { count: String(roleMeta[diff.role]?.user_count ?? 0) })}
                  </p>
                )}
                {diff.addedCodenames.length > 0 && (
                  <p className="text-02 text-[hsl(var(--color-status-success))] font-mono">+ {diff.addedCodenames.join(", ")}</p>
                )}
                {diff.removedCodenames.length > 0 && (
                  <div>
                    <p className="text-02 text-[hsl(var(--color-status-error))] mb-1">{t("permissions.matrix.confirm_removed_label")}</p>
                    <ul className="text-02 font-mono text-[hsl(var(--color-status-error))] list-disc list-inside space-y-1">
                      {diff.removedCodenames.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                )}
                {diff.tier === 3 && (
                  <div className="mt-2 space-y-2 border-t border-[hsl(var(--color-hairline))] pt-2">
                    <p className="text-02 text-[hsl(var(--color-status-error))] font-medium">
                      {t("permissions.matrix.confirm_clear_warning", { role: diff.role })}
                    </p>
                    {diff.removesMenuRead && (
                      <p className="text-02 text-[hsl(var(--color-status-error))]">{t("permissions.matrix.confirm_menu_read_warning")}</p>
                    )}
                    <label htmlFor={`type-confirm-${diff.role}`} className="block text-02 text-[hsl(var(--color-ink-muted))]">
                      {t("permissions.matrix.confirm_type_role_label", { role: diff.role })}
                    </label>
                    <input
                      id={`type-confirm-${diff.role}`}
                      type="text"
                      value={typedRoleNames[diff.role] ?? ""}
                      onChange={(e) => setTypedRoleNames((prev) => ({ ...prev, [diff.role]: e.target.value }))}
                      placeholder={diff.role}
                      className="w-full px-2 py-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 font-mono text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </BaseModal>
      </RequirePermission>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// One category's sticky sub-header row + its permission rows. Split out so
// the render loop above stays readable — this is still page-local, not a
// shared component (see file-ownership note in the task this was built from).
// ─────────────────────────────────────────────────────────────────────────

function FragmentCategory({
  category,
  perms,
  visiblePerms,
  roleNames,
  checked,
  isSaving,
  onToggle,
  categoryTally,
}: {
  category: string;
  perms: Permission[];
  visiblePerms: Permission[];
  roleNames: string[];
  checked: GrantMap | null;
  isSaving: boolean;
  onToggle: (role: string, permId: number) => void;
  categoryTally: (perms: Permission[], role: string) => string;
}) {
  return (
    <>
      {/* `top-[44px]` 对着表头那一行的 h-11。z 值与表头同在一个层叠上下文里
          比较(sticky 挂在单元格上,不挂在 <tr> 上),所以角单元格 z-30 稳定地
          压在同行其它分类格 z-20 之上,而整行仍在表头 z-30/z-40 之下。 */}
      <tr>
        <td className="sticky top-[44px] left-0 z-30 bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))] px-3 py-1 text-02 uppercase text-[hsl(var(--color-ink-muted))] font-semibold">
          {category}
        </td>
        {roleNames.map((role) => (
          <td key={role} className="sticky top-[44px] z-20 bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))] px-2 py-1 text-02 text-center text-[hsl(var(--color-ink-subtle))] font-mono">
            {categoryTally(perms, role)}
          </td>
        ))}
      </tr>
      {visiblePerms.map((perm) => (
        /* 行悬停从 `surface-2/40` 换成不透明的 surface-2。冻结的那一列必须有
           不透明底色(否则横向滚过去的单元格会从它底下透出来),而一个不透明的
           格子拿不到 <tr> 的半透明底 —— 两边不同色就等于把「这一行」画成两段。
           所以整行改用同一个不透明值,冻结格靠 group-hover 跟上。 */
        <tr key={perm.id} className="group hover:bg-[hsl(var(--color-surface-2))]">
          <td className="sticky left-0 z-10 bg-[hsl(var(--color-canvas))] group-hover:bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))]/50 px-3 py-1 transition-colors">
            <div className="font-mono text-02 text-[hsl(var(--color-ink))]">{perm.codename}</div>
            <div className="text-02 text-[hsl(var(--color-ink-subtle))]">{perm.name}</div>
          </td>
          {roleNames.map((role) => (
            <td key={role} className="border-b border-[hsl(var(--color-hairline))]/50 px-1 py-1 text-center">
              <MatrixCell
                granted={checked?.[role]?.has(perm.id) ?? false}
                disabled={isSaving}
                label={`${role} — ${perm.codename}`}
                onToggle={() => onToggle(role, perm.id)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
