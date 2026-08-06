"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { permApi, Permission, Role, RolePermissions, RolePermissionConflict } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { Skeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import { RoleFormModal } from "@/src/components/permissions/RoleFormModal";
import { DataTable } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";

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
      className={`flex items-center justify-center w-full h-8 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-accent))] ${
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[hsl(var(--color-surface-3))]"
      }`}
    >
      {granted ? (
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-[hsl(var(--color-accent))]" fill="currentColor" aria-hidden="true">
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

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-2xl lg:text-3xl font-bold text-[hsl(var(--color-accent))]">
          {t("permissions.title")}
          <MenuGloss path="/permissions" />
        </h1>
        <p className="text-sm sm:text-base text-[hsl(var(--color-ink-subtle))] mt-1 hidden sm:block">{t("permissions.subtitle")}</p>
      </div>

      <RequirePermission permissions="ADMIN" fallback={<div className="px-6"><PermissionDenied /></div>}>
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-8">
          {/* ── Conflict banner ── */}
          {conflict && (
            <div role="alert" className="bg-[hsl(var(--color-status-error))]/10 border border-[hsl(var(--color-status-error))]/40 rounded-lg p-4 flex items-center justify-between gap-4">
              <p className="text-sm text-[hsl(var(--color-status-error))]">
                {t("permissions.matrix.conflict_message", {
                  role: roleMeta[conflict.role]?.display_name || conflict.role,
                  expected: String(conflict.expected),
                  current: String(conflict.current),
                })}
              </p>
              <button
                type="button"
                onClick={resolveConflict}
                disabled={conflictRoleQuery?.isFetching}
                className="shrink-0 px-3 py-1.5 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
              >
                {conflictRoleQuery?.isFetching ? t("permissions.matrix.conflict_reloading") : t("permissions.matrix.conflict_reload_button")}
              </button>
            </div>
          )}

          {/* ── Matrix ── */}
          <PageSection
            title={t("permissions.matrix.title")}
            isLoading={permsQuery.isLoading || rolesQuery.isLoading}
            error={permsQuery.isError || rolesQuery.isError || rolePermsError ? t("permissions.matrix.load_error") : undefined}
          >
            {(nonSubsetPair || countParadox) && (
              <div className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg p-4 mb-4 text-sm space-y-1.5">
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
                className="flex-1 min-w-[200px] px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--color-ink-muted))] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyDifferences}
                  onChange={(e) => setOnlyDifferences(e.target.checked)}
                  className="accent-[hsl(var(--color-accent))]"
                />
                {t("permissions.matrix.only_differences")}
              </label>
              <div className="flex-1" />
              <span className="text-xs text-[hsl(var(--color-ink-subtle))]">
                {liveDiffs.length > 0
                  ? t("permissions.matrix.pending_count", { count: String(liveDiffs.length) })
                  : t("permissions.matrix.no_changes")}
              </span>
              <button
                type="button"
                onClick={handleSaveClick}
                disabled={liveDiffs.length === 0 || isSaving || !matrixReady}
                className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-40 disabled:cursor-not-allowed text-black rounded text-sm font-medium transition-colors"
              >
                {isSaving ? t("permissions.matrix.saving") : t("permissions.matrix.save_button")}
              </button>
            </div>

            {!matrixReady ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : roleNames.length === 0 ? (
              <p className="text-sm text-[hsl(var(--color-ink-muted))]">{t("permissions.matrix.no_roles")}</p>
            ) : (
              <div className="overflow-y-auto max-h-[65vh] border border-[hsl(var(--color-hairline))] rounded-lg">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="sticky top-0 z-30 h-11 bg-[hsl(var(--color-surface-1))] border-b border-[hsl(var(--color-hairline))]">
                      <th className="text-left px-3 font-medium text-[hsl(var(--color-ink-muted))]">
                        {t("permissions.matrix.codename_col")}
                      </th>
                      {roleNames.map((role) => (
                        <th key={role} className="px-2 font-medium text-[hsl(var(--color-ink))] min-w-[110px] text-center">
                          <div>{roleMeta[role]?.display_name || role}</div>
                          <div className="text-[11px] font-normal text-[hsl(var(--color-ink-subtle))] font-mono">
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
                  <button
                    onClick={() => setIsCreateOpen(true)}
                    className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium transition-colors"
                  >
                    + {t("permissions.create")}
                  </button>
                </RequirePermission>
              ) : undefined
            }
          >
            <DataTable<Permission>
              caption={t("permissions.all_permissions")}
              columns={[
                { key: "codename", header: t("permissions.codename") },
                { key: "name", header: t("permissions.name") },
                { key: "category", header: t("permissions.category") },
                { key: "action", header: t("souls.action"), align: "right" },
              ]}
              data={permsQuery.data ?? []}
              isLoading={permsQuery.isLoading}
              isError={permsQuery.isError}
              keyExtractor={(perm) => String(perm.id)}
              renderRow={(perm) => (
                <>
                  <td className="px-4 py-3 font-mono text-[hsl(var(--color-accent))] text-xs">{perm.codename}</td>
                  <td className="px-4 py-3 text-[hsl(var(--color-ink))]">{perm.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] rounded text-xs">
                      {perm.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RequirePermission permissions="system.settings">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => { setEditingPerm(perm); setIsEditOpen(true); }}
                          className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))] text-xs"
                        >
                          {t("permissions.edit")}
                        </button>
                        <button
                          onClick={() => { setDeletingPerm(perm); setIsDeleteOpen(true); }}
                          className="text-[hsl(var(--color-status-error))] hover:text-[hsl(var(--color-status-error)/0.8)] text-xs"
                        >
                          {t("permissions.delete")}
                        </button>
                      </div>
                    </RequirePermission>
                  </td>
                </>
              )}
            />
          </PageSection>

          {/* ── Roles CRUD ── */}
          <RequirePermission permissions="system.settings">
            <PageSection
              title={t("permissions.roles_title")}
              isLoading={rolesQuery.isLoading}
              actions={
                !rolesQuery.isLoading ? (
                  <button
                    onClick={() => setIsRoleCreateOpen(true)}
                    className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium transition-colors"
                  >
                    + {t("permissions.create_role")}
                  </button>
                ) : undefined
              }
            >
              {rolesQuery.isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
                      <Skeleton className="h-4 w-2/3 mb-2" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {(rolesQuery.data ?? []).map((role) => (
                    <div key={role.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-3 hover:border-[hsl(var(--color-accent))]/30 transition-colors">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-[hsl(var(--color-ink))] truncate text-sm">{role.display_name || role.name}</h3>
                        <p className="text-xs text-[hsl(var(--color-ink-muted))] font-mono truncate">{role.name}</p>
                        <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-0.5">{t("permissions.matrix.role_users", { count: String(role.user_count) })}</p>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => { setEditingRole(role); setIsRoleEditOpen(true); }}
                          className="flex-1 px-2 py-1 text-xs text-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))]/10 rounded transition-colors border border-[hsl(var(--color-accent))]/30"
                        >
                          {t("permissions.edit_role")}
                        </button>
                        <button
                          onClick={() => { setDeletingRole(role); setIsRoleDeleteOpen(true); }}
                          className="flex-1 px-2 py-1 text-xs text-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.1)] rounded transition-colors border border-[hsl(var(--color-status-error)/0.3)]"
                        >
                          {t("permissions.delete_role")}
                        </button>
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
              <button
                type="button"
                onClick={() => { setIsDeleteOpen(false); setDeletingPerm(null); }}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 rounded text-sm transition-colors"
              >
                {t("permissions.cancel_delete")}
              </button>
              <button
                type="button"
                onClick={() => deletingPerm && deleteMutation.mutate(deletingPerm.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
              >
                {deleteMutation.isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
              </button>
            </div>
          }
        >
          <p className="text-[hsl(var(--color-ink))] text-sm">{t("permissions.confirm_delete_message")}</p>
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
              <button
                type="button"
                onClick={() => { setIsRoleDeleteOpen(false); setDeletingRole(null); }}
                disabled={roleDeleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 rounded text-sm transition-colors"
              >
                {t("permissions.cancel_delete")}
              </button>
              <button
                type="button"
                onClick={() => deletingRole && roleDeleteMutation.mutate(deletingRole.id)}
                disabled={roleDeleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
              >
                {roleDeleteMutation.isPending ? t("permissions.deleting") : t("permissions.confirm_delete_action")}
              </button>
            </div>
          }
        >
          <p className="text-[hsl(var(--color-ink))] text-sm">{t("permissions.confirm_delete_role_message")}</p>
        </BaseModal>

        {/* ── Three-tier save confirmation (tier 2 and tier 3 diffs) ── */}
        <BaseModal
          isOpen={confirmOpen}
          onClose={() => { if (!isSaving) { setConfirmOpen(false); setPendingDiffs([]); } }}
          title={t("permissions.matrix.confirm_title")}
          footer={
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setPendingDiffs([]); }}
                disabled={isSaving}
                className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 rounded text-sm transition-colors"
              >
                {t("permissions.matrix.confirm_cancel")}
              </button>
              <button
                type="button"
                onClick={() => void runSave(pendingDiffs)}
                disabled={isSaving || !canConfirmSave}
                className="flex-1 px-4 py-2 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
              >
                {isSaving ? t("permissions.matrix.confirm_submitting") : t("permissions.matrix.confirm_submit")}
              </button>
            </div>
          }
        >
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-sm text-[hsl(var(--color-status-warning))]">{t("permissions.matrix.confirm_replace_notice")}</p>
            {pendingDiffs.map((diff) => (
              <div key={diff.role} className="border border-[hsl(var(--color-hairline))] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-[hsl(var(--color-ink))] text-sm">{roleMeta[diff.role]?.display_name || diff.role}</h4>
                  <span className="text-xs font-mono text-[hsl(var(--color-ink-muted))]">{diff.beforeCount} → {diff.afterCount}</span>
                </div>
                {diff.tier >= 2 && (
                  <p className="text-xs text-[hsl(var(--color-ink-muted))]">
                    {t("permissions.matrix.confirm_user_count", { count: String(roleMeta[diff.role]?.user_count ?? 0) })}
                  </p>
                )}
                {diff.addedCodenames.length > 0 && (
                  <p className="text-xs text-[hsl(var(--color-status-success))] font-mono">+ {diff.addedCodenames.join(", ")}</p>
                )}
                {diff.removedCodenames.length > 0 && (
                  <div>
                    <p className="text-xs text-[hsl(var(--color-status-error))] mb-1">{t("permissions.matrix.confirm_removed_label")}</p>
                    <ul className="text-xs font-mono text-[hsl(var(--color-status-error))] list-disc list-inside space-y-0.5">
                      {diff.removedCodenames.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                )}
                {diff.tier === 3 && (
                  <div className="mt-2 space-y-2 border-t border-[hsl(var(--color-hairline))] pt-2">
                    <p className="text-xs text-[hsl(var(--color-status-error))] font-medium">
                      {t("permissions.matrix.confirm_clear_warning", { role: diff.role })}
                    </p>
                    {diff.removesMenuRead && (
                      <p className="text-xs text-[hsl(var(--color-status-error))]">{t("permissions.matrix.confirm_menu_read_warning")}</p>
                    )}
                    <label htmlFor={`type-confirm-${diff.role}`} className="block text-xs text-[hsl(var(--color-ink-muted))]">
                      {t("permissions.matrix.confirm_type_role_label", { role: diff.role })}
                    </label>
                    <input
                      id={`type-confirm-${diff.role}`}
                      type="text"
                      value={typedRoleNames[diff.role] ?? ""}
                      onChange={(e) => setTypedRoleNames((prev) => ({ ...prev, [diff.role]: e.target.value }))}
                      placeholder={diff.role}
                      className="w-full px-2 py-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-sm font-mono text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </BaseModal>
      </RequirePermission>
    </div>
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
      <tr className="sticky top-[44px] z-20 bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))]">
        <td className="px-3 py-1.5 text-xs uppercase tracking-wide text-[hsl(var(--color-ink-muted))] font-semibold">
          {category}
        </td>
        {roleNames.map((role) => (
          <td key={role} className="px-2 py-1.5 text-xs text-center text-[hsl(var(--color-ink-subtle))] font-mono">
            {categoryTally(perms, role)}
          </td>
        ))}
      </tr>
      {visiblePerms.map((perm) => (
        <tr key={perm.id} className="border-b border-[hsl(var(--color-hairline))]/50 hover:bg-[hsl(var(--color-surface-2))]/40">
          <td className="px-3 py-1.5">
            <div className="font-mono text-xs text-[hsl(var(--color-ink))]">{perm.codename}</div>
            <div className="text-[11px] text-[hsl(var(--color-ink-subtle))]">{perm.name}</div>
          </td>
          {roleNames.map((role) => (
            <td key={role} className="px-1 py-1 text-center">
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
