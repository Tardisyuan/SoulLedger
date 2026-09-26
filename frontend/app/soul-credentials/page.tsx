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
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { RevealCredentialDialog } from "@/src/components/soul-accounts/RevealCredentialDialog";
import { EmailNotSyncedNote } from "@/src/components/soul-accounts/EmailNotSyncedNote";
import {
  CREDENTIAL_FILTERS,
  credentialTone,
  credentialReason,
  failureKey,
  isExpired,
  lifeNumber,
} from "@/src/components/soul-accounts/soulAccountsView";

// 操作列定宽,不是 `auto`:表头那一格是空的,`auto` 在表头里解成 0、在数据行里解成
// 按钮宽,两边的 fr 列于是按不同的余量分配,表头与数据错开(2026-09-25 截图里实测)。
const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,2fr)_minmax(0,1.3fr)_10rem] md:items-center md:gap-4";

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
        /* 筛选签(规范 v1 §2),仍是 aria-pressed 的单选:再按一下已按下的签不改变筛选 ——
           「全部」本身就是其中一枚签,不是「什么都不按」。 */
        <FilterChipToggle
          key={value || "all"}
          pressed={status === value}
          onPressedChange={() => {
            setStatus(value);
            setPage(1);
          }}
        >
          {t(`soul_accounts.credentials.filters.${value || "all"}`)}
        </FilterChipToggle>
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

  const label = "md:hidden font-mono text-2xs text-[oklch(var(--color-ink-subtle))]";

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
      {/* 账页(规范 v1 §2):不装框;表头 11 px 等宽,下接区块边界线,行与行之间是行线。 */}
      <div>
        <div
          aria-hidden="true"
          className={`hidden px-3 py-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-block))] ${ROW_GRID}`}
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
                className={`px-3 py-3 md:py-2 space-y-3 md:space-y-0 border-b border-[oklch(var(--color-rule))] ${ROW_GRID}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-[oklch(var(--color-ink))] break-words">
                    <Link href={`/souls/${c.soul}`} className="hover:underline">
                      {c.soul_name}
                    </Link>
                  </p>
                  <p className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))] break-all">{c.soul_code}</p>
                  <StatusBadge namespace="soul_accounts.credential_status" value={c.status} tone={credentialTone(c.status)} />
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.cycle")}</p>
                  <p className="text-sm">{t("soul_accounts.life", { n: lifeNumber(c.cycle) })}</p>
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.reason")}</p>
                  <p className="text-sm text-[oklch(var(--color-ink-muted))] break-words">{t(reason.key, reason.params)}</p>
                  {c.email_not_synced === "taken" && <EmailNotSyncedNote />}
                  {c.revealed_at && (
                    <p className="text-xs text-[oklch(var(--color-ink-subtle))] break-words">
                      {t("soul_accounts.credentials.revealed_by", { by: c.revealed_by ?? "", time: formatDateTime(c.revealed_at) })}
                    </p>
                  )}
                  {c.delivered_at && (
                    <p className="text-xs text-[oklch(var(--color-ink-subtle))] break-words">
                      {t("soul_accounts.credentials.delivered_by", { by: c.delivered_by ?? "", time: formatDateTime(c.delivered_at) })}
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className={label}>{t("soul_accounts.fields.expires_at")}</p>
                  <p className="font-mono text-xs">{formatDateTime(c.expires_at)}</p>
                  {expired && c.status !== "DELIVERED" && <Badge tone="error" glyph="✕">{t("soul_accounts.credentials.expired")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-1 md:justify-end">
                  {canManage && c.status === "PENDING" && !expired && (
                    <>
                      <Button type="button" size="sm" variant="ghost" className="text-[oklch(var(--color-warning))]" onClick={() => setRevealing(c)}>
                        {t("soul_accounts.credentials.actions.reveal")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
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
                      variant="ghost"
                      className="text-[oklch(var(--color-accent-ink))]"
                      loading={deliver.isPending && deliver.variables === c.id}
                      onClick={() => doDeliver(c)}
                    >
                      {t("soul_accounts.credentials.actions.mark_delivered")}
                    </Button>
                  )}
                  {canManage && expired && c.status !== "DELIVERED" && (
                    <Link
                      href={`/souls/${c.soul}#soul-account`}
                      className="px-2 text-xs underline text-[oklch(var(--color-accent-ink))]"
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
