"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recycleBinApi, type RecycleBinEntry } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum, DomainNumber, DomainText } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { DataTable } from "@/components/ui/data-table";

/**
 * Global recycle bin (Stage 4 §4.7) — one screen listing soft-deleted
 * PARENT rows across every registered entity type (today: souls and
 * menus — see backend/apps/core/recycle_bin.py's registry), each with a
 * dependent count rather than its cascaded rows listed separately.
 *
 * ADMIN-only (recycle_bin.read/.restore/.hard_delete — see
 * backend/apps/core/recycle_bin_views.py), matching every other
 * administrative screen in this app.
 */
export default function RecycleBinPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [confirmHardDelete, setConfirmHardDelete] = useState<RecycleBinEntry | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["recycle-bin"],
    queryFn: async () => (await recycleBinApi.list()).data,
  });
  const entries = data?.results ?? [];

  const restoreMutation = useMutation({
    mutationFn: (cascadeId: string) => recycleBinApi.restore(cascadeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
      showToast(t("recycle_bin.restore_success"), "success");
    },
    onError: () => showToast(t("recycle_bin.restore_error"), "error"),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (entry: RecycleBinEntry) => recycleBinApi.hardDelete(entry.entity_type, entry.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
      showToast(t("recycle_bin.hard_delete_success"), "success");
      setConfirmHardDelete(null);
    },
    onError: () => {
      showToast(t("recycle_bin.hard_delete_error"), "error");
      setConfirmHardDelete(null);
    },
  });

  // `t(key) || entityType` never fired its fallback — t() returns the KEY on
  // a miss, which is truthy, so an uncovered entity type printed
  // "recycle_bin.entity_types.SOUL" at the user (BRIEF §4.6).
  const entityLabel = (entityType: string) =>
    resolveEnumDisplay(t, "recycle_bin.entity_types", entityType).label ?? t("common.value.unrecorded");

  return (
    <RequirePermission
      permissions="recycle_bin.read"
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[hsl(var(--color-ink-subtle))]">
          {t("recycle_bin.no_access")}
        </div>
      }
    >
      <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
        <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
          <h1 className="text-lg font-bold text-[hsl(var(--color-accent-ink))] flex-1">
            {t("recycle_bin.title")}
          </h1>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-6">
          <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">{t("recycle_bin.intro")}</p>

          <DataTable<RecycleBinEntry>
            caption={t("recycle_bin.title")}
            columns={[
              { key: "type", header: t("recycle_bin.col_type") },
              { key: "label", header: t("recycle_bin.col_item") },
              { key: "dependents", header: t("recycle_bin.col_dependents") },
              { key: "deleted", header: t("recycle_bin.col_deleted") },
              { key: "action", header: t("recycle_bin.col_action"), align: "right" },
            ]}
            data={entries}
            isLoading={isLoading}
            isError={Boolean(error)}
            keyExtractor={(entry) => `${entry.entity_type}-${entry.id}`}
            renderRow={(entry) => (
              <>
                <td className="px-4 py-3">
                  <DomainEnum
                    namespace="recycle_bin.entity_types"
                    value={entry.entity_type}
                    className="px-1.5 py-0.5 bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] rounded text-xs"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-[hsl(var(--color-ink))]">{entry.label}</div>
                  {entry.delete_reason && (
                    <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-0.5">
                      {entry.delete_reason}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">
                  {entry.dependent_count > 0
                    ? t("recycle_bin.dependent_count", {
                        type: entityLabel(entry.entity_type),
                        name: entry.label,
                        count: String(entry.dependent_count),
                      })
                    : <DomainNumber value={entry.dependent_count} />}
                </td>
                <td className="px-4 py-3 text-xs text-[hsl(var(--color-ink-subtle))]">
                  <DomainText value={entry.deleted_at ? new Date(entry.deleted_at).toLocaleString() : null} />
                  {entry.deleted_by && (
                    <div>{t("recycle_bin.deleted_by", { user: entry.deleted_by })}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-3">
                    <RequirePermission permissions="recycle_bin.restore">
                      <button
                        onClick={() => entry.cascade_id && restoreMutation.mutate(entry.cascade_id)}
                        disabled={!entry.cascade_id || restoreMutation.isPending}
                        className="text-[hsl(var(--color-accent-ink))] hover:text-[hsl(var(--color-accent-hover))] text-sm disabled:opacity-50"
                      >
                        {t("recycle_bin.restore")}
                      </button>
                    </RequirePermission>
                    {entry.kind === "reference" && (
                      <RequirePermission permissions="recycle_bin.hard_delete">
                        <button
                          onClick={() => setConfirmHardDelete(entry)}
                          disabled={!entry.hard_delete_eligible}
                          title={
                            entry.hard_delete_eligible
                              ? undefined
                              : t("recycle_bin.hard_delete_not_yet_eligible", {
                                  days: String(entry.retention_days ?? 30),
                                })
                          }
                          className="text-[hsl(var(--color-status-error))] hover:text-[hsl(var(--color-status-error)/0.8)] text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t("recycle_bin.hard_delete")}
                        </button>
                      </RequirePermission>
                    )}
                  </div>
                </td>
              </>
            )}
            emptyMessage={t("recycle_bin.empty")}
          />
        </div>

        {confirmHardDelete && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg">
              <div className="px-6 py-5">
                <h3 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-2">
                  {t("recycle_bin.hard_delete_confirm_title")}
                </h3>
                <p className="text-sm text-[hsl(var(--color-ink-muted))]">
                  {t("recycle_bin.hard_delete_confirm_message", { name: confirmHardDelete.label })}
                </p>
              </div>
              <div className="px-6 pb-5 flex gap-3">
                <button
                  onClick={() => setConfirmHardDelete(null)}
                  className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] rounded text-sm transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={() => hardDeleteMutation.mutate(confirmHardDelete)}
                  disabled={hardDeleteMutation.isPending}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {t("recycle_bin.hard_delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RequirePermission>
  );
}
