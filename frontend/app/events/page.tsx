"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { eventsApi, PAGE_SIZE } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { ColumnMenu, DataGrid, useColumnVisibility, type DataGridColumn } from "@/components/ui/data-grid";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { isSystemActor } from "@/lib/events/event_registry";
import { makeSystemEventLabels } from "@/src/components/souls/soulLifecycleRows";
import { LIFECYCLE_ANCHOR } from "@/src/components/souls/detail/SoulTimelineColumn";
import { EventTypeFilter } from "@/src/components/events/EventTypeFilter";
import { useRememberedFilters } from "@/src/lib/rememberedFilters";
import {
  buildEventRows,
  eventDetail,
  eventListParams,
  startDate,
  type DatePreset,
  type SoulEventRow,
} from "@/src/components/events/soulEventRows";

/**
 * 灵魂事件(第三十七批 W-13):全殿的 SoulEvent 流水,侧栏「灵魂业务」组、灵魂管理之下
 * (`backend/apps/menus/migrations/0023_b37_add_soul_events_menu.py`)。
 *
 * 看的是持灵魂读权限的官员,接口与灵魂详情页的时间线是同一个(`GET /events/`,不另设码)。
 * 只有灵魂可点(进详情页、定位到生命周期时间线);操作人没有详情页,要只看某人用筛选。
 * 排序只按时间倒序 —— 类型已经能筛,不出「按事件类型排」。每页 20 条。
 */
export default function SoulEventsPage() {
  // The sidebar hides the link without soul.read, but a typed URL still lands here.
  return (
    <RequirePermission permissions="soul.read" fallback={<PermissionDenied permission="soul.read" />}>
      <SoulEventsContent />
    </RequirePermission>
  );
}

const EVENTS_FILTERS_KEY = "soulledger.events.filters";
const EVENTS_FILTER_FIELDS = ["eventType", "actor", "datePreset", "includeSystem"] as const;
const EVENTS_COLUMNS_KEY = "soulledger.events.columns";

function SoulEventsContent() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.records")) });

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const [actor, setActor] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("7d");
  // 系统事件默认收起,和灵魂详情页的「含系统事件」一致。
  const [includeSystem, setIncludeSystem] = useState(false);
  // 本浏览器记住筛选(与其他列表页同一套)。日期「全部」是空串，空串不存，所以记成 `all`;灵魂搜索不记。
  useRememberedFilters(
    EVENTS_FILTERS_KEY,
    EVENTS_FILTER_FIELDS,
    { eventType, actor, datePreset: datePreset || "all", includeSystem: includeSystem ? "1" : "" },
    (saved) => {
      if (saved.eventType) setEventType(saved.eventType);
      if (saved.actor) setActor(saved.actor);
      if (saved.datePreset === "7d" || saved.datePreset === "30d") setDatePreset(saved.datePreset);
      if (saved.datePreset === "all") setDatePreset("");
      if (saved.includeSystem === "1") setIncludeSystem(true);
    }
  );

  // 灵魂搜索走服务器(`search`),停手 300ms 再发,同灵魂列表。
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = eventListParams({ search, eventType, actor, datePreset, includeSystem, page });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["soul-events", params],
    queryFn: async () => (await eventsApi.list(params)).data,
    // 翻页 / 换筛选时留着上一页，不闪骨架。
    placeholderData: (previous) => previous,
  });

  const actorsStart = startDate(datePreset);
  const { data: actors = [] } = useQuery({
    queryKey: ["soul-events", "actors", actorsStart ?? ""],
    queryFn: async () => (await eventsApi.actors(actorsStart ? { start_date: actorsStart } : undefined)).data,
  });

  const rows = useMemo(() => buildEventRows(data?.results ?? []), [data?.results]);
  const labels = useMemo(() => makeSystemEventLabels(t), [t]);

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  const isFiltered = Boolean(search || eventType || actor || datePreset);
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setEventType("");
    setActor("");
    setDatePreset("");
    setPage(1);
  };

  const columns: DataGridColumn<SoulEventRow>[] = [
    {
      type: "timestamp",
      key: "time",
      header: t("events.col_time"),
      width: "160px",
      value: (r) => r.lead.create_time,
      format: (v) => formatDateTime(v),
    },
    {
      type: "text",
      key: "soul",
      header: t("events.col_soul"),
      pinned: true,
      width: "200px",
      value: ({ lead }) => (
        <Link
          href={`/souls/${lead.soul}#${LIFECYCLE_ANCHOR}`}
          data-testid="soul-event-soul"
          className="underline underline-offset-3 text-[oklch(var(--color-ink))]"
        >
          {lead.soul_name || t("common.value.unrecorded")}
        </Link>
      ),
    },
    {
      type: "text",
      key: "event",
      header: t("events.col_event"),
      width: "200px",
      value: ({ lead, count }) => (
        <>
          {labels.eventType(lead.event_type)}
          {count > 1 ? <span className="ml-1 text-[oklch(var(--color-ink-muted))]">×{count}</span> : null}
        </>
      ),
    },
    {
      type: "text",
      key: "actor",
      header: t("events.col_actor"),
      width: "120px",
      value: ({ lead }) =>
        isSystemActor(lead.actor) ? (
          <span className="text-[oklch(var(--color-ink-muted))]">{t("events.actor_system")}</span>
        ) : (
          lead.actor
        ),
    },
    {
      type: "text",
      key: "detail",
      header: t("events.col_detail"),
      // Design:其余写 —。默认的「未记录」画的就是 —(「不适用」会写成字)。
      value: ({ lead }) => eventDetail(lead, labels, t),
    },
  ];

  // 列菜单(与审计页同一个 `ColumnMenu`):灵魂列钉住，其余可隐藏，本浏览器记住。
  const columnVis = useColumnVisibility(EVENTS_COLUMNS_KEY, columns);

  const title = (
    <>
      {t("nav.soul_events")}
      <MenuGloss path="/events" />
    </>
  );

  return (
    <PageShell
      variant="full"
      title={title}
      filters={
        <>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("events.search_soul")}
            aria-label={t("events.search_soul")}
            className={cn(fieldControl({ size: "md" }), "w-60")}
          />
          <EventTypeFilter value={eventType} onChange={(v) => { setEventType(v); setPage(1); }} />
          <FilterChipSelect
            label={t("events.col_actor")}
            value={actor}
            options={[
              { value: "", label: t("events.all_actors") },
              ...(actor && !actors.includes(actor) ? [...actors, actor] : actors).map((a) => ({ value: a, label: a })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("events.col_actor") })}
            onChange={(v) => { setActor(v); setPage(1); }}
          />
          <FilterChipSelect
            label={t("events.col_time")}
            value={datePreset}
            options={[
              { value: "", label: t("audit.date_all") },
              { value: "7d", label: t("audit.date_7d") },
              { value: "30d", label: t("audit.date_30d") },
            ]}
            clearLabel={t("filter.clear_one", { name: t("events.col_time") })}
            onChange={(v) => { setDatePreset(v as DatePreset); setPage(1); }}
          />
          <label className="ml-auto flex items-center gap-2 text-sm text-[oklch(var(--color-ink-muted))] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSystem}
              onChange={(e) => { setIncludeSystem(e.target.checked); setPage(1); }}
              className="accent-[oklch(var(--color-accent))]"
            />
            {t("events.include_system")}
          </label>
          <ColumnMenu
            className="ml-auto"
            columns={columns.map((c) => ({ key: c.key, header: String(c.header), pinned: c.pinned }))}
            visibility={columnVis}
            buttonLabel={t("list.columns.button", { shown: String(columnVis.shown), total: String(columnVis.total) })}
            pinnedLabel={t("list.columns.pinned")}
            hintLabel={t("list.columns.hint")}
            resetLabel={t("list.columns.reset")}
          />
        </>
      }
    >
      <DataGrid<SoulEventRow>
        caption={t("nav.soul_events")}
        columns={columns}
        hiddenColumns={columnVis.hidden}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        errorMessage={t("events.failed")}
        onRetry={() => refetch()}
        keyExtractor={(r) => r.key}
        isFiltered={isFiltered}
        onClearFilters={clearFilters}
        emptyMessage={t("events.empty_all")}
        filteredEmptyMessage={t("events.empty")}
        page={page}
        totalPages={totalPages}
        totalCount={data?.count}
        onPageChange={setPage}
      />
    </PageShell>
  );
}
