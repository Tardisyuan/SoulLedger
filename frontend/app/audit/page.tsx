"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi, PAGE_SIZE, type AuditLogEntry } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { DataGrid, parseOrdering, type DataGridColumn, type EnumValue } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import {
  collapseRepeats,
  groupAuditLogsByTrace,
  localDayKey,
  REPEAT_WINDOW_MS,
  type AuditGroup,
  type AuditRun,
} from "@/lib/auditGrouping";
import { TreeName } from "@/src/components/ui/TreeRow";
import { usePermissions } from "@/src/hooks/usePermissions";
import { FilterChipSelect, FilterChipToggle } from "@/src/components/ui/FilterChip";
import { fieldControl } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/lib/utils";

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

/** One grid row: an event, the run it belongs to, and whether it leads that run. */
interface AuditRow {
  group: AuditGroup;
  run: AuditRun;
  lead: boolean;
}

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
  const { t, formatDate, formatDateTime } = useI18n();
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

  // Presets are always "N days ago through now" — there is no end bound to
  // compute, so this only ever produces `dateFrom` (`end_date` was dead: the
  // corresponding value was hardcoded "" on every branch).
  const dateFrom = useMemo(() => {
    if (!datePreset) return "";
    const days = datePreset === "7d" ? 7 : 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    return from.toISOString().slice(0, 10);
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
      if (ordering) params.ordering = ordering;

      const res = await auditApi.list(params);
      return res.data;
    },
    enabled: canReadAudit,
  });

  // Client-side search across resource/description on the page already
  // fetched — the audit endpoint has no dedicated `search` param (see
  // lib/api/audit.ts / backend/apps/audit/views.py's filterset_fields).
  //
  // `data?.results ?? []` lives *inside* the callback rather than above it.
  // Hoisted, the `?? []` fallback minted a fresh array on every render where
  // `data` was undefined, so the memo it fed re-ran every render and handed
  // `groups` below a new identity each time — a useMemo that memoised
  // nothing. The dependency is the query result itself, which TanStack keeps
  // referentially stable between fetches.
  const filteredLogs = useMemo(() => {
    const logs = data?.results ?? [];
    if (!search) return logs;
    const needle = search.toLowerCase();
    return logs.filter(
      (log: AuditLogEntry) =>
        log.resource.toLowerCase().includes(needle) || log.description.toLowerCase().includes(needle)
    );
  }, [data?.results, search]);

  const groups = useMemo(() => groupAuditLogsByTrace(filteredLogs), [filteredLogs]);

  // 合并同类 + 按日分组头(第三类 D 组答复)。A collapsed run shows only its
  // first member; `expanded` holds the run keys the operator opened. Day counts
  // are EVENTS on this page, not runs — "12" under a day should not shrink
  // because some of them were folded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = useMemo<AuditRow[]>(
    () =>
      collapseRepeats(groups).flatMap((run) =>
        (expanded.has(run.key) ? run.members : run.members.slice(0, 1)).map((group, i) => ({
          group,
          run,
          lead: i === 0,
        }))
      ),
    [groups, expanded]
  );
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(localDayKey(g.time), (counts.get(localDayKey(g.time)) ?? 0) + 1);
    return counts;
  }, [groups]);
  const toggleRun = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  const isFiltered = Boolean(actionFilter || resourceFilter || datePreset || search);
  const clearFilters = () => {
    setActionFilter("");
    setResourceFilter("");
    setDatePreset("");
    setSearch("");
    setPage(1);
  };

  const columns: DataGridColumn<AuditRow>[] = [
    {
      type: "timestamp",
      key: "timestamp",
      header: t("audit.timestamp"),
      sortable: true,
      width: "212px",
      value: (r) => r.group.time,
      format: (v) => formatDateTime(v),
    },
    {
      type: "text",
      key: "user",
      header: t("audit.user"),
      width: "150px",
      value: (r) => r.group.userDisplay,
    },
    {
      type: "enum",
      key: "action",
      header: t("audit.action"),
      width: "128px",
      value: ({ group: g }) => {
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
      value: ({ group: g, run, lead }) => {
        const repeats = run.members.length;
        const open = expanded.has(run.key);
        return (
          // A run's later members sit one level in, under the lead's └ —
          // the same tree-row mark /menus uses, for the same "belongs to the
          // row above" meaning.
          <TreeName depth={lead ? 0 : 1}>
            <div className="min-w-0">
              <div className="text-[oklch(var(--color-ink))]">
                {g.descriptions.length > 0 ? g.descriptions.join(" · ") : g.resources.join(" + ")}
                {lead && repeats > 1 && (
                  <button
                    type="button"
                    data-testid="audit-repeat-toggle"
                    aria-expanded={open}
                    title={t("audit.repeat_rule", { minutes: String(REPEAT_WINDOW_MS / 60000) })}
                    onClick={() => toggleRun(run.key)}
                    className="ml-2 font-mono text-xs text-[oklch(var(--color-accent-ink))] hover:underline"
                  >
                    ×{repeats} · {open ? t("audit.repeat_collapse") : t("audit.repeat_expand")}
                  </button>
                )}
              </div>
              {/* 02 档正是 ID / 时间戳 / 资源标识那一档。`mt-0.5`(2px) 不在节奏
                  阶梯上，收到最小的一格 `mt-1`(4px)。 */}
              <div className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))] mt-1">{g.resourceDetail}</div>
            </div>
          </TreeName>
        );
      },
    },
    {
      type: "identifier",
      key: "ip",
      header: t("audit.ip_address"),
      width: "132px",
      value: (r) => r.group.ip,
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
        /* 筛选签(规范 v1 §2),与灵魂列表同一套:搜索框用共享的 `fieldControl`,
           三个枚举筛选各是一枚「维度 · 值 ×」,紧凑是一枚开关签。
           这里原来是 data-grid 的 `FilterBar` —— 一块自带边框和底色的面板,
           里面的签是自绘的 listbox。 */
        <>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("audit.search_placeholder")}
            aria-label={t("audit.search_placeholder")}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
          />
          <FilterChipSelect
            label={t("audit.filter_action")}
            value={actionFilter}
            options={[
              { value: "", label: t("audit.all_actions") },
              ...ACTION_OPTIONS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("audit.filter_action") })}
            onChange={(v) => { setActionFilter(v); setPage(1); }}
          />
          <FilterChipSelect
            label={t("audit.filter_resource")}
            value={resourceFilter}
            options={[{ value: "", label: t("audit.all_resources") }, ...RESOURCE_OPTIONS]}
            clearLabel={t("filter.clear_one", { name: t("audit.filter_resource") })}
            onChange={(v) => { setResourceFilter(v); setPage(1); }}
          />
          <FilterChipSelect
            label={t("audit.timestamp")}
            value={datePreset}
            options={[
              { value: "", label: t("audit.date_all") },
              { value: "7d", label: t("audit.date_7d") },
              { value: "30d", label: t("audit.date_30d") },
            ]}
            clearLabel={t("filter.clear_one", { name: t("audit.timestamp") })}
            onChange={(v) => { setDatePreset(v as DatePreset); setPage(1); }}
          />
          <FilterChipToggle pressed={compact} onPressedChange={setCompact}>
            {t("audit.compact")}
          </FilterChipToggle>
          {isFiltered && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              {t("audit.clear_filters")}
            </Button>
          )}
        </>
      }
    >
      {/* The shell's `pagination` slot stays empty on purpose: DataGrid renders
          its own <Pagination> off the four props below, and filling both would
          put two pagination bars on the page. */}
      <DataGrid<AuditRow>
        caption={t("audit.title")}
        columns={columns}
        data={rows}
        groupHeader={(r, i) => {
          const day = localDayKey(r.group.time);
          if (i > 0 && localDayKey(rows[i - 1].group.time) === day) return null;
          return `${formatDate(r.group.time, { year: "numeric", month: "long", day: "numeric", weekday: "short" })} · ${dayCounts.get(day) ?? 0}`;
        }}
        density={compact ? "compact" : "comfortable"}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        keyExtractor={(r) => r.group.key}
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
