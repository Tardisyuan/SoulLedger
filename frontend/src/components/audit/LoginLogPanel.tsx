"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loginLogsApi, PAGE_SIZE, type LoginLogEntry, type LoginLogStatus } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DataTable } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { fieldControl } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";
import { localDayKey } from "@/lib/auditGrouping";
import { AuditTabs } from "./AuditTabs";
import { cn } from "@/lib/utils";

const STATUSES: LoginLogStatus[] = ["SUCCESS", "FAILED"];

/**
 * /audit/logins — `LoginLog` rows for this tenant's users, newest first, with
 * the audit trail's day heads. Status and username go to the server
 * (`filterset_fields` / `search_fields` on `LoginLogViewSet`), so a page of
 * FAILED rows is a page of failures, not the failures that happened to be on
 * page 1. ADMIN-only on the wire; the route mounts this inside `RequireAdmin`.
 */
export function LoginLogPanel() {
  const { t, formatDate, formatDateTime } = useI18n();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | LoginLogStatus>("");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["login-logs", page, status, search],
    queryFn: async () =>
      (
        await loginLogsApi.list({
          page: String(page),
          ...(status ? { status } : {}),
          ...(search ? { search } : {}),
        })
      ).data,
    placeholderData: (previous) => previous,
  });
  const rows = data?.results ?? [];
  const isFiltered = Boolean(status || search);
  const clearFilters = () => {
    setStatus("");
    setSearch("");
    setPage(1);
  };

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("audit.login_log.title")}
          <MenuGloss path="/audit" />
        </>
      }
      tabs={<AuditTabs />}
      filters={
        <>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("audit.login_log.search_placeholder")}
            aria-label={t("audit.login_log.search_placeholder")}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
          />
          <FilterChipSelect
            label={t("audit.login_log.status_label")}
            value={status}
            options={[
              { value: "", label: t("filter.all") },
              ...STATUSES.map((s) => ({ value: s, label: t(`audit.login_log.status.${s}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("audit.login_log.status_label") })}
            onChange={(v) => {
              setStatus(v as "" | LoginLogStatus);
              setPage(1);
            }}
          />
          {isFiltered && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              {t("audit.clear_filters")}
            </Button>
          )}
        </>
      }
    >
      <DataTable<LoginLogEntry>
        caption={t("audit.login_log.title")}
        columns={[
          { key: "timestamp", header: t("audit.timestamp"), width: "212px" },
          { key: "username", header: t("audit.login_log.username"), width: "150px" },
          { key: "status", header: t("audit.login_log.status_label"), width: "128px" },
          { key: "failure_reason", header: t("audit.login_log.failure_reason") },
          { key: "ip", header: t("audit.ip_address"), width: "132px" },
          { key: "user_agent", header: t("audit.login_log.user_agent") },
        ]}
        data={rows}
        groupHeader={(row, i) => {
          const day = localDayKey(row.timestamp);
          if (i > 0 && localDayKey(rows[i - 1].timestamp) === day) return null;
          return formatDate(row.timestamp, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
        }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFiltered={isFiltered}
        onClearFilters={clearFilters}
        emptyMessage={t("audit.login_log.no_logs")}
        keyExtractor={(row) => String(row.id)}
        renderRow={(row) => (
          <>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {formatDateTime(row.timestamp)}
            </td>
            <td className="px-3 py-2 whitespace-nowrap text-[oklch(var(--color-ink))]">{row.username}</td>
            <td className="px-3 py-2 whitespace-nowrap">
              <StatusBadge
                namespace="audit.login_log.status"
                value={row.status}
                tone={row.status === "FAILED" ? "error" : "success"}
              />
            </td>
            <td className="px-3 py-2 text-sm text-[oklch(var(--color-ink-muted))]">
              {row.failure_reason || <MissingValue kind="inapplicable" />}
            </td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
              {row.ip_address || <MissingValue kind="unrecorded" />}
            </td>
            <td className="max-w-80 truncate px-3 py-2 text-xs text-[oklch(var(--color-ink-subtle))]" title={row.user_agent}>
              {row.user_agent || <MissingValue kind="unrecorded" />}
            </td>
          </>
        )}
        page={page}
        totalPages={Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))}
        totalCount={data?.count ?? 0}
        onPageChange={setPage}
      />
    </PageShell>
  );
}
