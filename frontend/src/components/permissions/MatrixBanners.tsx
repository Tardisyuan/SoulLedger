"use client";

import { useEffect } from "react";
import type { MatrixConflict, MatrixWorkflowConflict, Permission, Role } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import type { CellFailure } from "./useMatrixCells";

const roleName = (roleMeta: Record<string, Role>, role: string) => roleMeta[role]?.display_name || role;

/**
 * 部分失败横幅 PartialFailBanner(E-11a):「已存 N 项，失败 M 项」,逐格写原因,
 * 「定位」把焦点送到失败的格子上。失败的格子仍是未保存状态(带 !),所以放弃或
 * 改回去之后横幅里的那一行也就没了。
 */
export function PartialFailBanner({
  saved,
  failures,
  roleMeta,
  permsById,
  reason,
  onLocate,
  onDismiss,
}: {
  saved: number;
  failures: CellFailure[];
  roleMeta: Record<string, Role>;
  permsById: Record<number, Permission>;
  reason: (f: CellFailure) => string;
  onLocate: (f: CellFailure) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div role="alert" className="border-l-2 border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {t("permissions.matrix.partial_title", { saved: String(saved), failed: String(failures.length) })}
        </p>
        <span className="flex-1" />
        {failures.length > 0 && (
          <Button type="button" size="sm" variant="secondary" onClick={() => onLocate(failures[0])}>
            {t("permissions.matrix.locate")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          {t("common.close")}
        </Button>
      </div>
      <ul className="mt-2 space-y-1">
        {failures.map((f) => {
          const perm = permsById[f.permissionId];
          return (
            <li key={`${f.role}:${f.permissionId}`} className="text-[oklch(var(--color-ink))]">
              {roleName(roleMeta, f.role)}
              {" · "}
              {perm ? `${perm.category} · ${perm.name}` : f.permissionId}
              {"："}
              <span className="text-[oklch(var(--color-ink-muted))]">{reason(f)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 冲突横幅(E-11a ◇):impact 接口说这组改动会让哪条审批流模板的哪一步、哪条进行中
 * 审批流的哪个待审节点无人可批,写明是谁的哪一格引起的。
 *
 * 保存要先勾「我知道这会让 N 条审批流(含进行中 M 条)无人可批」(2026-09-25 决定):
 * N 数的是不同的模板加不同的进行中审批流,M 是后者。服务端同样拒收未确认的冲突撤销
 * (`conflict_unacknowledged`),这里的勾选只是让确认发生在保存之前。
 */
export function ImpactConflictBanner({
  conflicts,
  workflowConflicts,
  acknowledged,
  onAcknowledge,
  roleMeta,
  permsById,
}: {
  conflicts: MatrixConflict[];
  workflowConflicts: MatrixWorkflowConflict[];
  acknowledged: boolean;
  onAcknowledge: (on: boolean) => void;
  roleMeta: Record<string, Role>;
  permsById: Record<number, Permission>;
}) {
  const { t } = useI18n();
  if (conflicts.length + workflowConflicts.length === 0) return null;
  const causes = (c: MatrixConflict | MatrixWorkflowConflict) =>
    c.caused_by.map((x) => `${roleName(roleMeta, x.role)}「${permsById[x.permission_id]?.name ?? x.codename}」`).join("、");
  const live = new Set(workflowConflicts.map((w) => w.workflow_id)).size;
  const flows = new Set(conflicts.map((c) => c.template_id)).size + live;
  return (
    <div role="status" className="border-l-2 border-[oklch(var(--color-warning))] bg-[oklch(var(--color-warning-tint))] px-4 py-3 text-sm">
      <p className="font-medium text-[oklch(var(--color-warning))]">
        <span aria-hidden="true">◇ </span>
        {t("permissions.matrix.conflict_title", { n: String(conflicts.length + workflowConflicts.length) })}
      </p>
      <ul className="mt-2 space-y-1">
        {conflicts.map((c) => (
          <li key={`${c.template_id}:${c.step_order}`} className="text-[oklch(var(--color-ink))]">
            {t("permissions.matrix.conflict_line", {
              causes: causes(c),
              template: c.template_name,
              step: String(c.step_order),
              step_name: c.step_name,
            })}
          </li>
        ))}
        {workflowConflicts.map((w) => (
          <li key={`${w.workflow_id}:${w.node_order}`} className="text-[oklch(var(--color-ink))]">
            {t("permissions.matrix.conflict_workflow_line", {
              causes: causes(w),
              workflow: w.workflow_name,
              step: String(w.node_order),
              step_name: w.node_name,
            })}
          </li>
        ))}
      </ul>
      <label className="mt-3 flex min-h-8 items-center gap-2 text-[oklch(var(--color-ink))] max-sm:min-h-11">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
          className="h-4 w-4 accent-[oklch(var(--color-warning))]"
        />
        {t("permissions.matrix.conflict_acknowledge", { n: String(flows), m: String(live) })}
      </label>
    </div>
  );
}

/**
 * 未保存条 UnsavedBar:底部常驻,「未保存 N 项 ＋a · −b」,放弃 / 保存 ⌘S。
 * ⌘S(Ctrl+S)在页面任何位置都保存,并拦下浏览器自己的「存网页」。
 */
export function UnsavedBar({
  count,
  grants,
  revokes,
  isSaving,
  saveDisabled = false,
  onDiscard,
  onSave,
}: {
  count: number;
  grants: number;
  revokes: number;
  isSaving: boolean;
  /** A conflict not yet acknowledged in the banner above (⌘S is ignored too — `onSave` checks). */
  saveDisabled?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onSave]);

  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label={t("permissions.matrix.unsaved_region")}
      className="sticky bottom-0 z-40 mt-3 flex flex-wrap items-center gap-3 border-t border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-4 py-2"
    >
      <span className="text-sm text-[oklch(var(--color-ink))]" aria-live="polite">
        {t("permissions.matrix.pending_cells", { n: String(count) })}
      </span>
      <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">
        ＋{grants} · −{revokes}
      </span>
      <span className="flex-1" />
      <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={isSaving}>
        {t("permissions.matrix.discard")}
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onSave}
        loading={isSaving}
        disabled={saveDisabled}
        aria-keyshortcuts="Meta+S Control+S"
      >
        {t("permissions.matrix.save_button")}
        <kbd aria-hidden="true" className="ml-2 font-mono text-2xs opacity-70">⌘S</kbd>
      </Button>
    </div>
  );
}
