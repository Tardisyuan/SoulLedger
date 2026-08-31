"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi, PAGE_SIZE, type AuditLogEntry } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { DataGrid, FilterBar, parseOrdering, type DataGridColumn, type EnumValue } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { groupAuditLogsByTrace, type AuditGroup } from "@/lib/auditGrouping";
import { usePermissions } from "@/src/hooks/usePermissions";

const ACTION_OPTIONS = [
  "CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "VIEW",
  "EXPORT", "IMPORT", "PERMISSION_CHANGE", "EXECUTE", "READ",
];

const RESOURCE_OPTIONS = [
  { value: "soul", label: "Soul" },
  { value: "user", label: "User" },
  { value: "workflow", label: "Workflow" },
  { value: "judgment", label: "Judgment" },
  { value: "soulrecord", label: "Soul Record" },
  { value: "permission", label: "Permission" },
];

type DatePreset = "" | "7d" | "30d";

/**
 * §1's "operator" tint for audit verbs, kept off the feedback palette (Stage
 * 1 violation the design doc calls out: DELETE rendering in the same red as
 * a system error). Only CREATE/LOGIN get a hue; everything else — including
 * DELETE — is neutral, distinguished by its glyph instead of by color.
 */
function actionEnumValue(action: string, t: (key: string) => string): EnumValue {
  const label = t(`audit.actions.${action}`);
  switch (action) {
    case "CREATE":
      return { tone: "info", glyph: "＋", label };
    case "LOGIN":
      return { tone: "info", glyph: "→", label };
    case "LOGOUT":
      return { tone: "neutral", glyph: "←", label };
    case "UPDATE":
      return { tone: "neutral", glyph: "✎", label };
    case "DELETE":
      return { tone: "neutral", glyph: "⌫", label };
    default:
      return { tone: "neutral", glyph: "•", label };
  }
}

export default function AuditPage() {
  const { t, formatDateTime } = useI18n();
  // `hasPermission("audit.read")`, not `isAdmin`.
  //
  // The backend grants `audit.read` to ADMIN **and MODERATOR**
  // (`apps/perm/models.py::ROLE_PERMISSIONS`), while this page asked
  // `role === "ADMIN"`. Measured: MODERATOR got "访问被拒绝 / 仅管理员可查看审计
  // 日志" and issued zero requests — refused by the UI for a permission it
  // holds. The audit finding that first described this page said it had **no**
  // gate at all; it had one, pointed at the wrong question. Both are in the
  // same ledger (M47 and M65), which is why this comment names the codename
  // rather than the role.
  const { hasPermission } = usePermissions();
  const canReadAudit = hasPermission("audit.read");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("");
  const [ordering, setOrdering] = useState("");
  const [compact, setCompact] = useState(false);

  const { dateFrom, dateTo } = useMemo(() => {
    if (!datePreset) return { dateFrom: "", dateTo: "" };
    const days = datePreset === "7d" ? 7 : 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: "" };
  }, [datePreset]);

  const { data, isLoading, isError, refetch } = useQuery({
    // `search` deliberately excluded — it filters the already-fetched page
    // client-side (see below) rather than triggering a new request per keystroke.
    queryKey: ["audit", page, actionFilter, resourceFilter, datePreset, ordering],
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
      return res.data;
    },
    enabled: canReadAudit,
  });

  const logs = data?.results ?? [];
  // Client-side search across resource/description on the page already
  // fetched — the audit endpoint has no dedicated `search` param (see
  // lib/api/audit.ts / backend/apps/audit/views.py's filterset_fields).
  const filteredLogs = useMemo(() => {
    if (!search) return logs;
    const needle = search.toLowerCase();
    return logs.filter(
      (log: AuditLogEntry) =>
        log.resource.toLowerCase().includes(needle) || log.description.toLowerCase().includes(needle)
    );
  }, [logs, search]);

  const groups = useMemo(() => groupAuditLogsByTrace(filteredLogs), [filteredLogs]);

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  const isFiltered = Boolean(actionFilter || resourceFilter || datePreset || search);
  const clearFilters = () => {
    setActionFilter("");
    setResourceFilter("");
    setDatePreset("");
    setSearch("");
    setPage(1);
  };

  const columns: DataGridColumn<AuditGroup>[] = [
    {
      type: "timestamp",
      key: "timestamp",
      header: t("audit.timestamp"),
      sortable: true,
      width: "212px",
      value: (g) => g.time,
      format: (v) => formatDateTime(v),
    },
    {
      type: "text",
      key: "user",
      header: t("audit.user"),
      width: "150px",
      value: (g) => g.userDisplay,
    },
    {
      type: "enum",
      key: "action",
      header: t("audit.action"),
      width: "128px",
      value: (g) => {
        const base = actionEnumValue(g.action, t);
        if (g.distinctActions.length <= 1) return base;
        return {
          ...base,
          label: `${base.label} +${g.distinctActions.length - 1}`,
          title: t("audit.events_from_writes", { count: String(g.entries.length) }),
        };
      },
    },
    {
      type: "text",
      key: "affected",
      header: t("audit.affected"),
      value: (g) => (
        <div>
          <div className="text-ink">
            {g.descriptions.length > 0 ? g.descriptions.join(" · ") : g.resources.join(" + ")}
          </div>
          {/* 02 档正是 ID / 时间戳 / 资源标识那一档。`mt-0.5`(2px) 不在节奏
              阶梯上，收到最小的一格 `mt-1`(4px)。 */}
          <div className="font-mono text-02 text-ink-tertiary mt-1">{g.resourceDetail}</div>
        </div>
      ),
    },
    {
      type: "identifier",
      key: "ip",
      header: t("audit.ip_address"),
      width: "132px",
      value: (g) => g.ip,
    },
  ];

  const title = (
    <>
      {t("audit.title")}
      <MenuGloss path="/audit" />
    </>
  );

  // Access denied. A refusal is a note in the file, not a poster,
  // so it goes through EmptyState (left-aligned, civ-marked) instead of the
  // centred `h-64` box — and the page keeps its header, so the operator can
  // still see *which* page refused them.
  if (!canReadAudit) {
    return (
      <PageShell variant="full" title={title}>
        <EmptyState title={t("audit.access_denied")} reason={t("audit.needs_audit_read")} />
      </PageShell>
    );
  }

  return (
    /* `full`, not `page`. This is the audit trail: its column count grows with
       whatever the backend decides to log, and a 1200px clamp is what turns a
       five-column ledger into a horizontally-scrolling one. */
    <PageShell
      variant="full"
      title={title}
      filters={
        <FilterBar
          /* The slot supplies the surface, the rule line and the padding, so
             the component's own card chrome comes off — otherwise it is a
             bordered panel sitting inside a bordered bar. */
          className="w-full p-0 border-0 bg-transparent"
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder={t("audit.search_placeholder")}
          chips={[
            {
              key: "action",
              label: t("audit.filter_action"),
              value: actionFilter,
              onChange: (v) => { setActionFilter(v); setPage(1); },
              options: [
                { value: "", label: t("audit.all_actions") },
                ...ACTION_OPTIONS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) })),
              ],
            },
            {
              key: "resource",
              label: t("audit.filter_resource"),
              value: resourceFilter,
              onChange: (v) => { setResourceFilter(v); setPage(1); },
              options: [
                { value: "", label: t("audit.all_resources") },
                ...RESOURCE_OPTIONS,
              ],
            },
            {
              key: "date",
              label: t("audit.date_all"),
              value: datePreset,
              onChange: (v) => { setDatePreset(v as DatePreset); setPage(1); },
              options: [
                { value: "", label: t("audit.date_all") },
                { value: "7d", label: t("audit.date_7d") },
                { value: "30d", label: t("audit.date_30d") },
              ],
            },
          ]}
          isFiltered={isFiltered}
          onClearAll={clearFilters}
          clearAllLabel={t("audit.clear_filters")}
          density={{ compact, onToggle: () => setCompact((c) => !c), label: t("audit.compact") }}
        />
      }
    >
      {/* The shell's `pagination` slot stays empty on purpose: DataGrid renders
          its own <Pagination> off the four props below, and filling both would
          put two pagination bars on the page. */}
      <DataGrid<AuditGroup>
        caption={t("audit.title")}
        columns={columns}
        data={groups}
        density={compact ? "compact" : "comfortable"}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        keyExtractor={(g) => g.key}
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
    </PageShell>
  );
}
