"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PAGE_SIZE, type InitialCredential } from "@soulledger/core/api";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import {
  classifySoulAccountError,
  useMarkCredentialDelivered,
  useRetryCredential,
  useSoulCredentials,
} from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { RevealCredentialDialog } from "@/src/components/soul-accounts/RevealCredentialDialog";
import {
  CREDENTIAL_FILTERS,
  credentialBadgeClass,
  credentialReason,
  failureKey,
  isExpired,
  lifeNumber,
} from "@/src/components/soul-accounts/soulAccountsView";

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,2fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-4";

function CredentialsPageContent() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("soul_account.manage");

  const [status, setStatus] = useState<string>("PENDING");
  const [page, setPage] = useState(1);
  const [revealing, setRevealing] = useState<InitialCredential | null>(null);

  const list = useSoulCredentials({ status: status || undefined, page });
  const retry = useRetryCredential();
  const deliver = useMarkCredentialDelivered();

  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const doRetry = (c: InitialCredential) =>
    retry.mutate(c.id, {
      onSuccess: (row) => {
        if (row.status === "SENT") showToast(t("soul_accounts.credentials.retry_sent"), "success");
        else showToast(t(credentialReason(row).key, credentialReason(row).params), "info");
      },
      onError: (error) =>
        showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.credentials.retry_failed")), "error"),
    });

  const doDeliver = (c: InitialCredential) =>
    deliver.mutate(c.id, {
      onSuccess: () => showToast(t("soul_accounts.credentials.delivered_ok"), "success"),
      onError: (error) =>
        showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.credentials.deliver_failed")), "error"),
    });

  const actions = (
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
  );

  const filters = (
    <div role="group" aria-label={t("soul_accounts.credentials.filters.label")} className="flex flex-wrap gap-2">
      {CREDENTIAL_FILTERS.map((value) => (
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
          {t(`soul_accounts.credentials.filters.${value || "all"}`)}
        </Button>
      ))}
    </div>
  );

  // Failed / nothing pending at all / nothing under this filter: three states, three looks.
  const failed = list.isError && !list.data;
  const empty = failed ? (
    <QueryError onRetry={() => list.refetch()} />
  ) : status === "PENDING" ? (
    <EmptyState title={t("soul_accounts.credentials.empty.pending")} reason={t("soul_accounts.credentials.empty.pending_reason")} />
  ) : (
    <EmptyState title={t("soul_accounts.credentials.empty.filtered")} />
  );

  const label = "md:hidden text-01 uppercase text-[oklch(var(--color-ink-subtle))]";

  return (
    <PageShell
      variant="full"
      title={t("soul_accounts.credentials.title")}
      subtitle={
        canManage
          ? t("soul_accounts.credentials.subtitle")
          : `${t("soul_accounts.credentials.subtitle")} · ${t("soul_accounts.credentials.manage_hint")}`
      }
      actions={actions}
      filters={filters}
      isLoading={list.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={failed || rows.length === 0}
      empty={empty}
      pagination={
        count > PAGE_SIZE
          ? { controls: <Pagination page={page} totalPages={totalPages} count={count} onPageChange={setPage} /> }
          : undefined
      }
    >
      <div className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))]">
        <div
          aria-hidden="true"
          className={`hidden px-4 py-2 text-01 uppercase text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-hairline))] ${ROW_GRID}`}
        >
          <span>{t("soul_accounts.fields.soul")}</span>
          <span>{t("soul_accounts.fields.cycle")}</span>
          <span>{t("soul_accounts.fields.reason")}</span>
          <span>{t("soul_accounts.fields.expires_at")}</span>
          <span />
        </div>
        <ul>
          {rows.map((c) => {
            const expired = isExpired(c);
            const reason = credentialReason(c);
            return (
              <li
                key={c.id}
                data-credential-id={c.id}
                className={`p-4 space-y-3 md:space-y-0 border-b border-[oklch(var(--color-hairline))] last:border-b-0 ${ROW_GRID}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-03 font-medium text-[oklch(var(--color-ink))] break-words">
                    <Link href={`/souls/${c.soul}`} className="underline text-[oklch(var(--color-accent-ink))]">
                      {c.soul_name}
                    </Link>
                  </p>
                  <p className="font-mono text-02 text-[oklch(var(--color-ink-tertiary))] break-all">{c.soul_code}</p>
                  <DomainEnum namespace="soul_accounts.credential_status" value={c.status} className={credentialBadgeClass(c.status)} />
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.cycle")}</p>
                  <p className="text-03">{t("soul_accounts.life", { n: lifeNumber(c.cycle) })}</p>
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.reason")}</p>
                  <p className="text-03 text-[oklch(var(--color-ink-muted))] break-words">{t(reason.key, reason.params)}</p>
                  {c.revealed_at && (
                    <p className="text-02 text-[oklch(var(--color-ink-subtle))] break-words">
                      {t("soul_accounts.credentials.revealed_by", { by: c.revealed_by ?? "", time: formatDateTime(c.revealed_at) })}
                    </p>
                  )}
                  {c.delivered_at && (
                    <p className="text-02 text-[oklch(var(--color-ink-subtle))] break-words">
                      {t("soul_accounts.credentials.delivered_by", { by: c.delivered_by ?? "", time: formatDateTime(c.delivered_at) })}
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.expires_at")}</p>
                  <p className="font-mono text-02">{formatDateTime(c.expires_at)}</p>
                  {expired && c.status !== "DELIVERED" && <Badge tone="error">{t("soul_accounts.credentials.expired")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {canManage && c.status === "PENDING" && !expired && (
                    <>
                      <Button type="button" size="sm" variant="warning" onClick={() => setRevealing(c)}>
                        {t("soul_accounts.credentials.actions.reveal")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        loading={retry.isPending && retry.variables === c.id}
                        onClick={() => doRetry(c)}
                      >
                        {t("soul_accounts.credentials.actions.retry")}
                      </Button>
                    </>
                  )}
                  {canManage && c.status === "REVEALED" && !expired && (
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={deliver.isPending && deliver.variables === c.id}
                      onClick={() => doDeliver(c)}
                    >
                      {t("soul_accounts.credentials.actions.mark_delivered")}
                    </Button>
                  )}
                  {canManage && expired && c.status !== "DELIVERED" && (
                    <Link
                      href={`/souls/${c.soul}#soul-account`}
                      className="text-03 underline text-[oklch(var(--color-accent-ink))]"
                    >
                      {t("soul_accounts.credentials.actions.go_reset")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {revealing && <RevealCredentialDialog key={revealing.id} credential={revealing} onClose={() => setRevealing(null)} />}
    </PageShell>
  );
}

export default function SoulCredentialsPage() {
  return (
    <RequirePermission permissions="soul_account.read" fallback={<PermissionDenied />}>
      <CredentialsPageContent />
    </RequirePermission>
  );
}
