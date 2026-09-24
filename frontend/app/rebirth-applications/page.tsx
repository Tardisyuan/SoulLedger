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
import { REBIRTH_FILTERS, lifeNumber, rebirthTone } from "@/src/components/soul-accounts/soulAccountsView";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";

// 操作列定宽,不是 `auto`:表头那一格是空的,`auto` 在表头里解成 0、在数据行里解成
// 按钮宽,两边的 fr 列于是按不同的余量分配,表头与数据错开(2026-09-25 截图里实测)。
const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_5rem] md:items-center md:gap-4";

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

  const label = "md:hidden font-mono text-2xs text-[oklch(var(--color-ink-subtle))]";

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
            /* 筛选签(规范 v1 §2),单选,aria-pressed 照旧;「全部」是其中一枚。 */
            <FilterChipToggle
              key={value || "all"}
              pressed={status === value}
              onPressedChange={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {value ? t(`soul_accounts.rebirth_status.${value}`) : t("soul_accounts.rebirth.filters.all")}
            </FilterChipToggle>
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
      {/* 账页(规范 v1 §2):不装框;表头 11 px 等宽,下接区块边界线,行与行之间是行线。 */}
      <div>
        <div
          aria-hidden="true"
          className={`hidden px-3 py-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-block))] ${ROW_GRID}`}
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
              className={`px-3 py-3 md:py-2 space-y-3 md:space-y-0 border-b border-[oklch(var(--color-rule))] ${ROW_GRID}`}
            >
              <div className="min-w-0 space-y-1">
                <Link href={`/souls/${a.soul}`} className="text-sm font-medium text-[oklch(var(--color-ink))] hover:underline break-words">
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
                <StatusBadge namespace="soul_accounts.rebirth_status" value={a.status} tone={rebirthTone(a.status)} />
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.rebirth.fields.created_at")}</p>
                <p className="font-mono text-xs">{formatDateTime(a.created_at)}</p>
              </div>
              <div className="flex md:justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(a)}>
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
