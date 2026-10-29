"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSessionsApi, PAGE_SIZE, type AdminSession, type AdminSessionKind } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DataTable } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { Segmented } from "@/src/components/ui/Segmented";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { AuditTabs } from "./AuditTabs";

/** What the confirm dialog is about to do: one session, or every session of one person. */
type Pending = { kind: "one"; row: AdminSession } | { kind: "user"; row: AdminSession };

/**
 * /audit/sessions — who is signed in right now, in this admin's halls (every hall for a hall-less admin), with a
 * force sign-out for one session or for everything a person has open. Officers and souls are two tabs. Clicking a
 * name narrows the list to that person. The row of the session this admin is using has no button: that one is
 * signed out from the top-right menu, and the server refuses it here too (`current_session`).
 * Backend: `backend/apps/authentication/admin_session_views.py` (`session.manage`).
 */
export function SessionsPanel() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AdminSessionKind>("officer");
  const [page, setPage] = useState(1);
  const [person, setPerson] = useState<AdminSession | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-sessions", kind, page, person?.user_id ?? null],
    queryFn: async () =>
      (
        await adminSessionsApi.list({
          kind,
          page: String(page),
          ...(person ? { user: String(person.user_id) } : {}),
        })
      ).data,
    placeholderData: (previous) => previous,
  });
  const rows = data?.results ?? [];

  const revoke = useMutation({
    mutationFn: async (p: Pending) => {
      if (p.kind === "one") await adminSessionsApi.revoke(p.row.id);
      else await adminSessionsApi.revokeUser(p.row.user_id);
    },
    onSuccess: (_res, p) => {
      showToast(t(p.kind === "one" ? "audit.sessions.revoked" : "audit.sessions.revoked_all", { name: p.row.username }), "success");
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-sessions"] });
    },
    onError: () => showToast(t("audit.sessions.revoke_failed"), "error"),
  });

  const clearPerson = () => {
    setPerson(null);
    setPage(1);
  };

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("audit.sessions.title")}
          <MenuGloss path="/audit" />
        </>
      }
      tabs={<AuditTabs />}
      filters={
        <>
          <Segmented
            label={t("audit.sessions.kind_label")}
            value={kind}
            options={[
              { value: "officer", label: t("audit.sessions.kind.officer") },
              { value: "soul", label: t("audit.sessions.kind.soul") },
            ]}
            onChange={(v) => {
              setKind(v as AdminSessionKind);
              setPerson(null);
              setPage(1);
            }}
          />
          {person && (
            <>
              <span className="text-sm text-[oklch(var(--color-ink-muted))]">
                {t("audit.sessions.filtered_by", { name: person.username })}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => setPending({ kind: "user", row: person })}>
                {t("audit.sessions.revoke_all")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearPerson}>
                {t("audit.clear_filters")}
              </Button>
            </>
          )}
        </>
      }
    >
      <DataTable<AdminSession>
        caption={t("audit.sessions.title")}
        columns={[
          { key: "username", header: t("audit.sessions.user"), width: "180px" },
          { key: "label", header: t("audit.sessions.device") },
          { key: "ip", header: t("audit.ip_address"), width: "132px" },
          { key: "last_seen_at", header: t("audit.sessions.last_seen"), width: "190px" },
          { key: "created_at", header: t("audit.sessions.signed_in"), width: "190px" },
          { key: "actions", header: <span className="sr-only">{t("audit.sessions.revoke")}</span>, width: "96px" },
        ]}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFiltered={Boolean(person)}
        onClearFilters={clearPerson}
        emptyMessage={t("audit.sessions.empty")}
        keyExtractor={(row) => row.id}
        renderRow={(row) => (
          <>
            <td className="px-3 py-2 whitespace-nowrap">
              <button
                type="button"
                className="text-[oklch(var(--color-ink))] underline-offset-2 hover:underline"
                onClick={() => {
                  setPerson(row);
                  setPage(1);
                }}
              >
                {row.display_name || row.username}
              </button>
              {row.tenant_code && (
                <span className="ml-2 font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{row.tenant_code}</span>
              )}
            </td>
            <td className="px-3 py-2 text-sm text-[oklch(var(--color-ink-muted))]">
              {row.label || <MissingValue kind="unrecorded" />}
              {row.current && <span className="ml-2 text-xs">{t("audit.sessions.current")}</span>}
            </td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {row.ip_address || <MissingValue kind="unrecorded" />}
            </td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {formatDateTime(row.last_seen_at)}
            </td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {formatDateTime(row.created_at)}
            </td>
            <td className="px-3 py-2 text-right">
              {!row.current && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setPending({ kind: "one", row })}>
                  {t("audit.sessions.revoke")}
                </Button>
              )}
            </td>
          </>
        )}
        page={page}
        totalPages={Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))}
        totalCount={data?.count ?? 0}
        onPageChange={setPage}
      />
      <ConfirmDialog
        isOpen={pending !== null}
        title={t(pending?.kind === "user" ? "audit.sessions.confirm_all_title" : "audit.sessions.confirm_title")}
        message={
          pending
            ? t(pending.kind === "user" ? "audit.sessions.confirm_all_message" : "audit.sessions.confirm_message", {
                name: pending.row.username,
                device: pending.row.label,
              })
            : ""
        }
        confirmText={t(pending?.kind === "user" ? "audit.sessions.revoke_all" : "audit.sessions.revoke")}
        confirmLoading={revoke.isPending}
        onConfirm={() => pending && revoke.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </PageShell>
  );
}
