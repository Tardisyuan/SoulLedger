"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { auditApi, type PaginatedResponse } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { PageSection } from "@/components/ui/page-section";
import { TableSkeleton } from "@/components/ui/skeleton";

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
  { value: "karma", label: "Karma" },
  { value: "permission", label: "Permission" },
];

export default function AuditPage() {
  const { t } = useI18n();
  const { isAdmin } = useTenant();

  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit", page, actionFilter, resourceFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(page),
        page_size: "20",
      };
      if (actionFilter) params.action = actionFilter;
      if (resourceFilter) params.resource = resourceFilter;
      if (dateFrom) params.start_date = dateFrom;
      if (dateTo) params.end_date = dateTo;

      const res = await auditApi.list(params);
      return res.data as PaginatedResponse<AuditLogEntry>;
    },
    enabled: isAdmin,
  });

  const logs = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / 20) : 0;

  // Access denied for non-admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
        <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
          <h1 className="text-lg font-bold text-amber-400 flex-1">
            {t("audit.title") || "审计日志"}
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
          {t("audit.title") || "审计日志"}
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
                {opt.value ? opt.label : t("audit.all_actions") || "所有操作"}
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
                {opt.value ? opt.label : t("audit.all_resources") || "所有资源"}
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
            placeholder={t("audit.filter_date_from") || "开始日期"}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500 transition-colors"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            placeholder={t("audit.filter_date_to") || "结束日期"}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-amber-500 transition-colors"
          />

          {(actionFilter || resourceFilter || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setActionFilter("");
                setResourceFilter("");
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
              className="px-3 py-2 text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded transition-colors"
            >
              {t("audit.clear_filters") || "清除筛选"}
            </button>
          )}
        </div>

        {/* Audit table */}
        <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={8} cols={6} />
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-[hsl(var(--color-ink-muted))]">
              {t("audit.no_logs") || "暂无审计日志"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-2))]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                      {t("audit.timestamp")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                      {t("audit.user")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                      {t("audit.action")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                      {t("audit.resource")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                      {t("audit.description")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-ink-subtle))] uppercase tracking-wider">
                      {t("audit.ip_address")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink-muted))] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-[hsl(var(--color-ink))] font-medium">
                        {log.user_display || log.user || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            log.action === "CREATE"
                              ? "bg-green-500/20 text-green-400"
                              : log.action === "UPDATE"
                              ? "bg-amber-500/20 text-amber-400"
                              : log.action === "DELETE"
                              ? "bg-red-500/20 text-red-400"
                              : log.action === "LOGIN" || log.action === "LOGOUT"
                              ? "bg-blue-500/20 text-blue-400"
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          {isLoading ? (
            <div className="h-5 w-32 bg-muted animate-pulse rounded" />
          ) : (
            <p className="text-sm text-[hsl(var(--color-ink-muted))]">
              {t("audit.page_info", { page: String(page), total: String(totalPages), count: String(data?.count || 0) })}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isFetching}
              className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
            >
              ← {t("common.prev") || "上一页"}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data || page >= totalPages || isFetching}
              className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
            >
              {t("common.next") || "下一页"} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}