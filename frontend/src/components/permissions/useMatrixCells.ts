"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MatrixChangesResult, MatrixConflict, Permission, Role, RolePermissions } from "@soulledger/core/api";
import { matrixCellKey, useApplyMatrixChanges, useMatrixImpact } from "@soulledger/core/hooks/usePermissionMatrix";
import { permKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { cloneGrantMap, computeRoleDiff, matrixChanges, type CellChange, type GrantMap, type RoleDiff } from "./matrixDiff";

/** A cell the last save did not write, and why (E-11a「!」). */
export interface CellFailure {
  role: string;
  permissionId: number;
  status: "refused" | "failed";
  code: string | null;
  detail: string | null;
}

/**
 * The matrix save pipeline on the per-cell endpoint
 * (POST /perm/role-permissions/changes/, backend/apps/perm/matrix.py).
 *
 * WHAT CHANGED FROM THE PER-ROLE PUT. The old loop sent each role's whole
 * grant set in turn and stopped at the first failure, so "saved" was a
 * property of a role and a failure halfway left the operator guessing. This
 * endpoint answers per cell, 200 whatever the mix: `saved` / `unchanged`
 * write, `refused` (with a `code` — `admin_only_permission`, `version_conflict`
 * …) and `failed` (a database error on that cell alone) do not. So the page can
 * say exactly which cells are in and which are not, and keep only the latter
 * pending — marked `!` with their reason — instead of a role-level verdict.
 *
 * THE IMPACT CHECK runs on the pending edits (debounced), and it is sent ALL of
 * them, grants included: a revoke on one role can be covered by a grant on
 * another, and only the whole set says whether a workflow step keeps an
 * approver. Its conflicts are keyed to the edits they were computed for, so a
 * stale answer is never drawn over newer edits.
 *
 * The tier gate in front of the save (typed role name before clearing a
 * role) is the old pipeline's and stays: it guards what the operator meant,
 * not how the request is shaped.
 */
export function useMatrixCells({
  checked,
  setChecked,
  baseline,
  roleNames,
  permsById,
  roleMeta,
}: {
  checked: GrantMap | null;
  setChecked: React.Dispatch<React.SetStateAction<GrantMap | null>>;
  baseline: GrantMap | null;
  roleNames: string[];
  permsById: Record<number, Permission>;
  roleMeta: Record<string, Role>;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const apply = useApplyMatrixChanges();
  const impact = useMatrixImpact();

  const changes: CellChange[] = checked && baseline ? matrixChanges(baseline, checked, roleNames) : [];
  const changesKey = changes.map((c) => `${c.action[0]}${matrixCellKey(c.role, c.permission_id)}`).join(",");

  const [failures, setFailures] = useState<Map<string, CellFailure>>(new Map());
  const [lastSave, setLastSave] = useState<{ saved: number; notSaved: number } | null>(null);
  const [impactResult, setImpactResult] = useState<{ key: string; conflicts: MatrixConflict[] } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<RoleDiff[]>([]);
  const [typedRoleNames, setTypedRoleNames] = useState<Record<string, string>>({});

  const impactMutate = impact.mutate;
  useEffect(() => {
    if (!changesKey) return;
    const pending = changes;
    const timer = setTimeout(() => {
      impactMutate(pending, { onSuccess: (r) => setImpactResult({ key: changesKey, conflicts: r.conflicts }) });
    }, 300);
    return () => clearTimeout(timer);
    // `changes` is rebuilt every render; `changesKey` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changesKey, impactMutate]);

  const conflicts = changesKey && impactResult?.key === changesKey ? impactResult.conflicts : [];
  /** Pending cells a conflict names as its cause (◇). */
  const conflictCells = new Set(conflicts.flatMap((c) => c.caused_by.map((x) => matrixCellKey(x.role, x.permission_id))));

  const pendingKeys = new Set(changes.map((c) => matrixCellKey(c.role, c.permission_id)));
  /** Failures still worth drawing: the cell is still pending. Toggled back, the `!` goes. */
  const liveFailures = [...failures.values()].filter((f) => pendingKeys.has(matrixCellKey(f.role, f.permissionId)));

  const isSaving = apply.isPending;

  const liveDiffs: RoleDiff[] =
    checked && baseline
      ? roleNames
          .map((role) => computeRoleDiff(role, baseline[role] ?? new Set(), checked[role] ?? new Set(), permsById))
          .filter((d): d is RoleDiff => d !== null)
      : [];

  function patchCaches(result: MatrixChangesResult) {
    // Server truth for what was written, now — the invalidation in
    // useApplyMatrixChanges refetches it, but until then the saved cells
    // would still read as pending.
    const byRole = new Map<string, { add: number[]; remove: number[] }>();
    for (const r of result.results) {
      if (r.status !== "saved") continue;
      const entry = byRole.get(r.role) ?? { add: [], remove: [] };
      (r.action === "grant" ? entry.add : entry.remove).push(r.permission_id);
      byRole.set(r.role, entry);
    }
    for (const [role, { add, remove }] of byRole) {
      queryClient.setQueryData<RolePermissions>(permKeys.rolePermissions(role), (old) => {
        if (!old) return old;
        const ids = new Set(old.details.map((p) => p.id));
        add.forEach((id) => ids.add(id));
        remove.forEach((id) => ids.delete(id));
        const details = [...ids].map((id) => permsById[id]).filter((p): p is Permission => !!p);
        return { ...old, details, permissions: details.map((p) => p.codename) };
      });
    }
    queryClient.setQueryData<Role[]>(permKeys.roles, (old) =>
      old?.map((r) => (r.name in result.versions ? { ...r, version: result.versions[r.name] } : r))
    );
    // A version conflict means someone else saved that role: reload it, so
    // the operator decides against what is really there.
    const stale = new Set(result.results.filter((r) => r.code === "version_conflict").map((r) => r.role));
    for (const role of stale) void queryClient.invalidateQueries({ queryKey: permKeys.rolePermissions(role) });
  }

  async function runSave() {
    if (changes.length === 0) return;
    const expectedVersions: Record<string, number> = {};
    for (const c of changes) {
      const v = roleMeta[c.role]?.version;
      if (v !== undefined) expectedVersions[c.role] = v;
    }
    try {
      const result = await apply.mutateAsync({ changes, expectedVersions });
      patchCaches(result);
      const next = new Map<string, CellFailure>();
      for (const r of result.results) {
        if (r.status === "refused" || r.status === "failed") {
          next.set(matrixCellKey(r.role, r.permission_id), {
            role: r.role,
            permissionId: r.permission_id,
            status: r.status,
            code: r.code ?? null,
            detail: r.detail ?? null,
          });
        }
      }
      setFailures(next);
      const notSaved = result.refused + result.failed;
      setLastSave({ saved: result.saved + result.unchanged, notSaved });
      if (notSaved === 0) showToast(t("permissions.matrix.saved_all", { n: String(result.saved + result.unchanged) }), "success");
    } catch {
      showToast(t("permissions.matrix.save_error"), "error");
    } finally {
      setConfirmOpen(false);
      setPendingDiffs([]);
    }
  }

  function handleSave() {
    if (changes.length === 0 || isSaving) return;
    const maxTier = Math.max(...liveDiffs.map((d) => d.tier));
    if (maxTier <= 1) {
      void runSave();
    } else {
      setPendingDiffs(liveDiffs);
      setTypedRoleNames({});
      setConfirmOpen(true);
    }
  }

  function discard() {
    if (!baseline || isSaving) return;
    setChecked(cloneGrantMap(baseline));
    setFailures(new Map());
    setLastSave(null);
  }

  const tier3 = pendingDiffs.filter((d) => d.tier === 3);
  const canConfirmSave = tier3.every((d) => (typedRoleNames[d.role] ?? "").trim() === d.role);

  return {
    changes,
    grants: changes.filter((c) => c.action === "grant").length,
    revokes: changes.filter((c) => c.action === "revoke").length,
    pendingKeys,
    conflicts,
    conflictCells,
    failures: liveFailures,
    failureAt: (key: string) => (pendingKeys.has(key) ? failures.get(key) ?? null : null),
    lastSave: lastSave && lastSave.notSaved > 0 ? lastSave : null,
    dismissLastSave: () => setLastSave(null),
    isSaving,
    handleSave,
    discard,
    confirmOpen,
    pendingDiffs,
    typedRoleNames,
    canConfirmSave,
    setTypedRoleName: (role: string, value: string) => setTypedRoleNames((prev) => ({ ...prev, [role]: value })),
    closeConfirm: () => {
      if (!isSaving) {
        setConfirmOpen(false);
        setPendingDiffs([]);
      }
    },
    confirmSave: () => void runSave(),
  };
}
