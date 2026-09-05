"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { permApi, Permission, Role, RolePermissions, RolePermissionConflict } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { cloneGrantMap, computeRoleDiff, type GrantMap, type RoleDiff } from "./matrixDiff";

/**
 * The matrix save pipeline: the live diff, the three-tier gate in front of it,
 * the per-role PUT loop, and the 409 optimistic-lock recovery. Lifted out of
 * app/permissions/page.tsx verbatim when that file was split for the 500-line
 * limit — the state it owns (isSaving / confirmOpen / pendingDiffs /
 * typedRoleNames / conflict) is exactly the state only this pipeline touched.
 */
export function useMatrixSave({
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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<RoleDiff[]>([]);
  const [typedRoleNames, setTypedRoleNames] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState<{ role: string; expected: number; current: number } | null>(null);
  /**
   * 中途失败时,**已经写进服务器**的那几个角色。
   *
   * `runSave` 是逐角色串行 PUT 的,第 k 个失败就 `return`。而前 k-1 个已经
   * 落库了 —— 服务器上的授权已经变了。此前那份 `summaries` 只在**全部成功**
   * 的路径上被显示(见函数末尾),失败路径直接把它丢掉,操作员只看到一句泛用的
   * `save_error`。
   *
   * 于是屏幕上是「保存失败」,而服务器上有一半角色已经改了。**这不是少说了
   * 一句话,是让操作员对已经发生的事实产生了错误认知** —— 他下一步很可能
   * 重试,而重试会把已经成功的那几个再 PUT 一遍(版本号已变,于是 409)。
   *
   * 用常驻 state 而不是 toast:toast 会消失,而这条信息正是操作员决定下一步
   * 时要看的。渲染在 `ConflictBanner` 旁边,见 `PartialSaveBanner`。
   */
  const [savedBeforeFailure, setSavedBeforeFailure] = useState<string[]>([]);

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
    // 上一次失败留下的清单不属于这一次。
    setSavedBeforeFailure([]);
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
        // 前面那些已经写进服务器了。把它们交出去,而不是跟着 `return`
        // 一起丢掉 —— 见 `savedBeforeFailure` 的注释。
        setSavedBeforeFailure(summaries);
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

  const tier3Diffs = pendingDiffs.filter((d) => d.tier === 3);
  const canConfirmSave = tier3Diffs.every((d) => (typedRoleNames[d.role] ?? "").trim() === d.role);

  return {
    savedBeforeFailure,
    dismissPartialSave: () => setSavedBeforeFailure([]),
    isSaving,
    conflict,
    confirmOpen,
    pendingDiffs,
    typedRoleNames,
    liveDiffs,
    canConfirmSave,
    handleSaveClick,
    resolveConflict,
    setTypedRoleName: (role: string, value: string) =>
      setTypedRoleNames((prev) => ({ ...prev, [role]: value })),
    closeConfirm: () => { if (!isSaving) { setConfirmOpen(false); setPendingDiffs([]); } },
    cancelConfirm: () => { setConfirmOpen(false); setPendingDiffs([]); },
    confirmSave: () => void runSave(pendingDiffs),
  };
}
