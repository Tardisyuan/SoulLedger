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
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { badgeVariants } from "@/src/components/ui/Badge";

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
        /* Was a `min-h-screen flex items-center justify-center` line of text.
           AppLayout already gives the slot `min-h-[calc(100vh-4rem)]`, so the
           extra min-h-screen was 64px of dead scroll; and a user who cannot
           read this screen should still be told which screen refused them,
           which is what keeping the shell does. */
        <PageShell title={t("recycle_bin.title")} variant="page">
          <EmptyState title={t("recycle_bin.title")} reason={t("recycle_bin.no_access")} />
        </PageShell>
      }
    >
      {/* variant="page" (1200), up from the hand-written max-w-5xl (1024).
          The intro sentence moves into the `subtitle` slot — it is one line
          saying what this screen is, which is exactly what that slot is for,
          and it was the only child above the table.

          The `pagination` slot is deliberately NOT filled: DataTable renders
          its own <Pagination> internally (data-table.tsx:288), and filling
          the slot as well would put two pagination bars on the page
          (PageShell.tsx:90). */}
      <PageShell
        title={t("recycle_bin.title")}
        variant="page"
        subtitle={t("recycle_bin.intro")}
      >
        {/* `compact` (~36px rows) because this page is scan-and-find: the operator
          is looking for a row, not deciding on each one. Decision surfaces
          (the judgment list) stay `comfortable`. */}
      <DataTable<RecycleBinEntry>
        density="compact"
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
                {/* DomainEnum takes the badge's classes and IS the badge, rather
                    than nesting inside a <Badge>: it renders exactly one span
                    and carries title={raw member} itself, which is the whole
                    point of the arrangement domainDisplayContract pins. */}
                <DomainEnum
                  namespace="recycle_bin.entity_types"
                  value={entry.entity_type}
                  className={badgeVariants({ tone: "neutral" })}
                />
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-ink">{entry.label}</div>
                {entry.delete_reason && (
                  <div className="text-02 text-ink-subtle mt-1">
                    {entry.delete_reason}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {entry.dependent_count > 0
                  ? t("recycle_bin.dependent_count", {
                      type: entityLabel(entry.entity_type),
                      name: entry.label,
                      count: String(entry.dependent_count),
                    })
                  : <DomainNumber value={entry.dependent_count} />}
              </td>
              <td className="px-4 py-3 text-02 text-ink-subtle">
                <DomainText value={entry.deleted_at ? new Date(entry.deleted_at).toLocaleString() : null} />
                {entry.deleted_by && (
                  <div>{t("recycle_bin.deleted_by", { user: entry.deleted_by })}</div>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-3">
                  <RequirePermission permissions="recycle_bin.restore">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => entry.cascade_id && restoreMutation.mutate(entry.cascade_id)}
                      disabled={!entry.cascade_id || restoreMutation.isPending}
                    >
                      {t("recycle_bin.restore")}
                    </Button>
                  </RequirePermission>
                  {entry.kind === "reference" && (
                    <RequirePermission permissions="recycle_bin.hard_delete">
                      {/* The title sits on the WRAPPER, not on the button.
                          Button's base class list carries
                          `disabled:pointer-events-none`, and an element with
                          pointer-events:none never receives the hover that
                          shows a native tooltip — so `title` on the disabled
                          button itself would be unreachable exactly when it
                          has something to say ("not eligible for another N
                          days"). The span is not disabled, so it still gets
                          the hover. */}
                      <span
                        className="inline-flex"
                        title={
                          entry.hard_delete_eligible
                            ? undefined
                            : t("recycle_bin.hard_delete_not_yet_eligible", {
                                days: String(entry.retention_days ?? 30),
                              })
                        }
                      >
                        <Button
                          variant="danger"
                          size="sm"
                          type="button"
                          onClick={() => setConfirmHardDelete(entry)}
                          disabled={!entry.hard_delete_eligible}
                        >
                          {t("recycle_bin.hard_delete")}
                        </Button>
                      </span>
                    </RequirePermission>
                  )}
                </div>
              </td>
            </>
          )}
          emptyMessage={t("recycle_bin.empty")}
        />

        {confirmHardDelete && (
          <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm bg-surface-2 border border-hairline">
              <div className="px-6 py-4">
                <h3 className="text-05 text-ink mb-2">
                  {t("recycle_bin.hard_delete_confirm_title")}
                </h3>
                <p className="text-04 text-ink-muted">
                  {t("recycle_bin.hard_delete_confirm_message", { name: confirmHardDelete.label })}
                </p>
              </div>
              <div className="px-6 pb-4 flex gap-3">
                <Button
                  variant="secondary"
                  type="button"
                  className="flex-1"
                  onClick={() => setConfirmHardDelete(null)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  className="flex-1"
                  onClick={() => hardDeleteMutation.mutate(confirmHardDelete)}
                  loading={hardDeleteMutation.isPending}
                >
                  {t("recycle_bin.hard_delete")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PageShell>
    </RequirePermission>
  );
}
