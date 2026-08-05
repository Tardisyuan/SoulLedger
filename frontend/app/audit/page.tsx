"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi, PAGE_SIZE, type PaginatedResponse } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { DataTable, parseOrdering, type SortState } from "@/components/ui/data-table";

interface AuditLogEntry {
  id: number;
  user: number | null;
  user_display?: string;
  action: string;
  resource: string;
  resource_id: string;
  description: string;
  ip_address: string | null;
  timestamp: string;
}

const ACTION_OPTIONS = [
  { value: "", label: "all_actions" },
  { value: "CREATE", label: "CREATE" },
  { value: "UPDATE", label: "UPDATE" },
  { value: "DELETE", label: "DELETE" },
  { value: "LOGIN", label: "LOGIN" },
  { value: "LOGOUT", label: "LOGOUT" },
  { value: "VIEW", label: "VIEW" },
  { value: "EXPORT", label: "EXPORT" },
  { value: "IMPORT", label: "IMPORT" },
  { value: "PERMISSION_CHANGE", label: "PERMISSION_CHANGE" },
  { value: "EXECUTE", label: "EXECUTE" },
  { value: "READ", label: "READ" },
];

const RESOURCE_OPTIONS = [
  { value: "", label: "all_resources" },
  { value: "soul", label: "Soul" },
  { value: "user", label: "User" },
  { value: "workflow", label: "Workflow" },
  { value: "judgment", label: "Judgment" },
  { value: "soulrecord", label: "Soul Record" },
  { value: "permission", label: "Permission" },
];

export default function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const { isAdmin } = useTenant();

  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ordering, setOrdering] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit", page, actionFilter, resourceFilter, dateFrom, dateTo, ordering],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(page),
        page_size: String(PAGE_SIZE),
      };
      if (actionFilter) params.action = actionFilter;
      if (resourceFilter) params.resource = resourceFilter;
      if (dateFrom) params.start_date = dateFrom;
      if (dateTo) params.end_date = dateTo;
      if (ordering) params.ordering = ordering;

      const res = await auditApi.list(params);
      return res.data as PaginatedResponse<AuditLogEntry>;
    },
    enabled: isAdmin,
  });

  const logs = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  const isFiltered = Boolean(actionFilter || resourceFilter || dateFrom || dateTo);
  const clearFilters = () => {
    setActionFilter("");
    setResourceFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  // Access denied for non-admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
        <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
          <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
            {t("audit.title")}
          </h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-[hsl(var(--color-ink-muted))] text-lg">{t("audit.access_denied")}</p>
            <p className="text-[hsl(var(--color-ink-subtle))] text-sm mt-2">
              {t("audit.admin_only")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("audit.title")}
        </h1>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Filters */}
        <div className="flex gap-4 mb-6 flex-wrap">
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500 transition-colors min-w-[160px]"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value ? opt.label : t("audit.all_actions")}
              </option>
            ))}
          </select>

          <select
            value={resourceFilter}
            onChange={(e) => {
              setResourceFilter(e.target.value);
              setPage(1);
            }}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500 transition-colors min-w-[160px]"
          >
            {RESOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value ? opt.label : t("audit.all_resources")}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            placeholder={t("audit.filter_date_from")}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500 transition-colors"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            placeholder={t("audit.filter_date_to")}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500 transition-colors"
          />

          {isFiltered && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded transition-colors"
            >
              {t("audit.clear_filters")}
            </button>
          )}
        </div>

        <DataTable<AuditLogEntry>
          caption={t("audit.title")}
          columns={[
            { key: "timestamp", header: t("audit.timestamp"), sortable: true },
            { key: "user", header: t("audit.user") },
            { key: "action", header: t("audit.action"), sortable: true },
            { key: "resource", header: t("audit.resource"), sortable: true },
            { key: "description", header: t("audit.description") },
            { key: "ip_address", header: t("audit.ip_address") },
          ]}
          data={logs}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          keyExtractor={(log) => String(log.id)}
          renderRow={(log) => (
            <>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))] whitespace-nowrap">
                {formatDateTime(log.timestamp)}
              </td>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink))] font-medium">
                {log.user_display || log.user || "-"}
              </td>
              <td className="px-4 py-3 text-sm">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    log.action === "CREATE"
                      ? "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]"
                      : log.action === "UPDATE"
                      ? "bg-[hsl(var(--color-status-warning)/0.2)] text-[hsl(var(--color-status-warning))]"
                      : log.action === "DELETE"
                      ? "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]"
                      : log.action === "LOGIN" || log.action === "LOGOUT"
                      ? "bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]"
                      : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"
                  }`}
                >
                  {t(`audit.actions.${log.action}`)}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))]">
                {log.resource}
                {log.resource_id && (
                  <span className="text-[hsl(var(--color-ink-subtle))] ml-1">#{log.resource_id}</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))] max-w-xs truncate">
                {log.description || "-"}
              </td>
              <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-subtle))] font-mono">
                {log.ip_address || "-"}
              </td>
            </>
          )}
          sort={parseOrdering(ordering)}
          onSortChange={(next) => {
            setOrdering(next ? `${next.direction === "desc" ? "-" : ""}${next.key}` : "");
            setPage(1);
          }}
          isFiltered={isFiltered}
          onClearFilters={clearFilters}
          emptyMessage={t("audit.no_logs")}
          page={page}
          totalPages={totalPages}
          totalCount={data?.count}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}