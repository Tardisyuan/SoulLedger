"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PAGE_SIZE, type OfficerRebirthApplication } from "@soulledger/core/api";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import { useRebirthApplications } from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { RebirthApplicationDetail } from "@/src/components/soul-accounts/RebirthApplicationDetail";
import { REBIRTH_FILTERS, lifeNumber, rebirthBadgeClass } from "@/src/components/soul-accounts/soulAccountsView";

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-4";

function RebirthApplicationsContent() {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<OfficerRebirthApplication | null>(null);

  const list = useRebirthApplications({ status: status || undefined, page });
  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  // Read the open application back out of the list, so a cross-civilization
  // decision (which invalidates the list) shows up in the open dialog.
  const shown = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null;

  const failed = list.isError && !list.data;
  const empty = failed ? (
    <QueryError onRetry={() => list.refetch()} />
  ) : status === "" ? (
    <EmptyState title={t("soul_accounts.rebirth.empty")} />
  ) : (
    <EmptyState
      title={t("soul_accounts.rebirth.empty_filtered")}
      action={
        <Button type="button" size="sm" variant="secondary" onClick={() => setStatus("")}>
          {t("soul_accounts.rebirth.filters.all")}
        </Button>
      }
    />
  );

  const label = "md:hidden text-2xs uppercase text-[oklch(var(--color-ink-subtle))]";

  return (
    <PageShell
      variant="full"
      title={t("soul_accounts.rebirth.title")}
      subtitle={t("soul_accounts.rebirth.subtitle")}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void queryClient.invalidateQueries({ queryKey: soulAccountKeys.all })}
          aria-busy={list.isFetching}
        >
          <RefreshCw aria-hidden="true" className={`w-4 h-4 mr-1 inline ${list.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
          {t("soul_accounts.refresh")}
        </Button>
      }
      filters={
        <div role="group" aria-label={t("soul_accounts.rebirth.filters.label")} className="flex flex-wrap gap-2">
          {REBIRTH_FILTERS.map((value) => (
            <Button
              key={value || "all"}
              type="button"
              size="sm"
              variant={status === value ? "primary" : "secondary"}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {value ? t(`soul_accounts.rebirth_status.${value}`) : t("soul_accounts.rebirth.filters.all")}
            </Button>
          ))}
        </div>
      }
      isLoading={list.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={failed || rows.length === 0}
      empty={empty}
      pagination={
        count > PAGE_SIZE
          ? {
              controls: (
                <Pagination page={page} totalPages={Math.ceil(count / PAGE_SIZE)} count={count} onPageChange={setPage} />
              ),
            }
          : undefined
      }
    >
      <div className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))]">
        <div
          aria-hidden="true"
          className={`hidden px-4 py-2 text-2xs uppercase text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-hairline))] ${ROW_GRID}`}
        >
          <span>{t("soul_accounts.fields.soul")}</span>
          <span>{t("soul_accounts.fields.cycle")}</span>
          <span>{t("soul_accounts.rebirth.fields.desired_form")}</span>
          <span>{t("soul_accounts.fields.status")}</span>
          <span>{t("soul_accounts.rebirth.fields.created_at")}</span>
          <span />
        </div>
        <ul>
          {rows.map((a) => (
            <li
              key={a.id}
              data-application-id={a.id}
              className={`p-4 space-y-3 md:space-y-0 border-b border-[oklch(var(--color-hairline))] last:border-b-0 ${ROW_GRID}`}
            >
              <div className="min-w-0 space-y-1">
                <Link href={`/souls/${a.soul}`} className="text-sm font-medium underline text-[oklch(var(--color-accent-ink))] break-words">
                  {a.soul_name}
                </Link>
                <p className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))] break-all">{a.soul_code}</p>
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.fields.cycle")}</p>
                <p className="text-sm">{t("soul_accounts.life", { n: lifeNumber(a.cycle) })}</p>
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.rebirth.fields.desired_form")}</p>
                <DomainEnum namespace="reincarnation.forms" value={a.desired_form} className="text-sm" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className={label}>{t("soul_accounts.fields.status")}</p>
                <DomainEnum namespace="soul_accounts.rebirth_status" value={a.status} className={rebirthBadgeClass(a.status)} />
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.rebirth.fields.created_at")}</p>
                <p className="font-mono text-xs">{formatDateTime(a.created_at)}</p>
              </div>
              <div className="flex md:justify-end">
                <Button type="button" size="sm" variant="secondary" onClick={() => setSelected(a)}>
                  {t("soul_accounts.rebirth.view")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {shown && <RebirthApplicationDetail key={shown.id} application={shown} onClose={() => setSelected(null)} />}
    </PageShell>
  );
}

export default function RebirthApplicationsPage() {
  return (
    <RequirePermission permissions="workflow.read" fallback={<PermissionDenied />}>
      <RebirthApplicationsContent />
    </RequirePermission>
  );
}
