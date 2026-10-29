"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { cityGodCasesApi, cityGodKeys, cityGodsApi, type CityGodCase } from "@soulledger/core/api";
import { isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { CaseNumber, DomainEnum } from "@/src/components/ui/DomainValue";
import { FilterChipSelect, FilterChipToggle } from "@/src/components/ui/FilterChip";
import { DataTable, ROW_LINK, type DataTableColumn } from "@/components/ui/data-table";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";
import { CityGodCaseDrawer } from "@/src/components/city-gods/CityGodCaseDrawer";
import { CITY_GOD_STATUS_TONES, MatchedOrigin } from "@/src/components/city-gods/cityGodDisplay";

/*
 * 城隍初审队列(Design 第五十三批 Q-1):两个页签 —— 在初审(待初审 + 退回补正,退回的在前,后端排)/ 已解送。
 * 筛选:城隍 +「只看我的城隍」(名下有城隍的官员默认开,殿管理员默认关)。出身地把决定归属的地名加粗下划线;
 * 兜底收的在城隍后面写「· 兜底」。`can_act=false` 的行整行灰字,下面一行「你不在这位城隍名下」,抽屉照样能打开。
 * `?city_god=<id>` 是城隍管理里「去初审队列」带来的;`?case=<id>` 是通知带来的,一进来就打开那件的抽屉。
 */

type Tab = "open" | "SENT_ON";
const SUBTLE = "text-[oklch(var(--color-ink-subtle))]";

function CityGodCasesContent() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const canTransfer = hasPermission("city_god.manage");
  const urlParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("open");
  const [page, setPage] = useState(1);
  const [cityGod, setCityGod] = useState(urlParams?.get("city_god") ?? "");
  const [onlyMine, setOnlyMine] = useState<boolean | null>(null);
  const [openId, setOpenId] = useState<string | null>(urlParams?.get("case") ?? null);

  const gods = useQuery({ queryKey: cityGodKeys.gods(), queryFn: () => cityGodsApi.list().then((r) => r.data.results) });
  const godList = gods.data ?? [];
  const defaults = new Set(godList.filter((g) => g.is_default).map((g) => g.id));
  const hasMine = godList.some((g) => g.officers.some((o) => o.id === user?.id));
  const mine = onlyMine ?? (!canTransfer && hasMine);

  const params: Record<string, string> = { page: String(page) };
  if (tab === "SENT_ON") params.status = "SENT_ON";
  if (cityGod) params.city_god = cityGod;
  if (mine) params.mine = "true";
  const list = useQuery({
    queryKey: cityGodKeys.cases(params),
    queryFn: () => cityGodCasesApi.list(params).then((r) => r.data),
    placeholderData: (previous) => previous,
    enabled: gods.isFetched,
  });
  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const change = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const columns: DataTableColumn[] = [
    { key: "case", header: t("judgment.case_number"), pinned: true },
    { key: "soul", header: t("judgment.soul_name") },
    { key: "origin", header: t("cityGodCases.origin_location") },
    { key: "city_god", header: t("cityGods.title") },
    { key: "status", header: t("souls.state") },
    { key: "registered", header: t("cityGodCases.registered_at") },
  ];

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("cityGodCases.title")}
          <MenuGloss path="/city-god-cases" />
        </>
      }
      tabs={
        <>
          {(["open", "SENT_ON"] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              data-testid={`city-god-tab-${tb}`}
              aria-pressed={tab === tb}
              onClick={() => change(() => setTab(tb))}
              className={`${TAB_BASE} ${tab === tb ? TAB_ON : TAB_OFF}`}
            >
              {tb === "open" ? t("cityGodCases.tab_open") : t("cityGodCases.status.SENT_ON")}
            </button>
          ))}
        </>
      }
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <FilterChipSelect
            label={t("cityGods.title")}
            value={cityGod}
            options={[{ value: "", label: t("cityGodCases.filter_city_god") }, ...godList.map((g) => ({ value: g.id, label: g.name }))]}
            clearLabel={t("filter.clear_one", { name: t("cityGods.title") })}
            onChange={(v) => change(() => setCityGod(v))}
          />
          <FilterChipToggle pressed={mine} onPressedChange={(v) => change(() => setOnlyMine(v))}>
            {t("cityGodCases.only_mine")}
          </FilterChipToggle>
        </div>
      }
    >
      <DataTable<CityGodCase>
        linkedRows
        caption={t("cityGodCases.title")}
        columns={columns}
        data={rows}
        isLoading={list.isLoading || gods.isLoading}
        isError={list.isError}
        onRetry={() => list.refetch()}
        isRefreshing={list.isPlaceholderData}
        skeletonRows={3}
        emptyMessage={t("cityGodCases.empty")}
        keyExtractor={(c) => c.id}
        renderRow={(c) => {
          const greyed = !c.can_act && tab === "open";
          return (
            <>
              <td className="px-3 py-2 whitespace-nowrap">
                <button type="button" className={cn(ROW_LINK, "text-left")} data-testid={`city-god-case-${c.id}`} onClick={() => setOpenId(c.id)}>
                  <CaseNumber value={c.case_number} variant="inline" />
                </button>
              </td>
              <td className={cn("px-3 py-2 text-sm", greyed ? SUBTLE : "text-[oklch(var(--color-ink))]")} data-can-act={c.can_act}>
                <span className="flex flex-wrap items-center gap-2">
                  {c.soul_name}
                  {c.untimely && <Badge tone="ink">{t("cityGodCases.untimely_badge")}</Badge>}
                  {c.untimely && isHeldUntilFatedDate(c) && (
                    <span className="font-mono text-2xs tabular-nums">{t("judgment.held_until", { date: c.held_until as string })}</span>
                  )}
                </span>
                {greyed && <span className="block text-2xs">{t("cityGodCases.cannot_act")}</span>}
              </td>
              <td className={cn("px-3 py-2 text-sm", greyed && SUBTLE)}>
                <MatchedOrigin location={c.origin_location} region={c.matched_region} />
              </td>
              <td className={cn("px-3 py-2 text-sm whitespace-nowrap", greyed && SUBTLE)}>
                {c.city_god_name}
                {/* 级别写成「· 府」小字,和「· 兜底」同一种写法(第五十七批 D-4)。 */}
                {c.city_god_rank && <span className="text-2xs"> · <DomainEnum namespace="cityGods.rank_short" value={c.city_god_rank} /></span>}
                {c.city_god && defaults.has(c.city_god) && !c.matched_region ? ` · ${t("cityGods.default_badge")}` : ""}
              </td>
              <td className={cn("px-3 py-2 whitespace-nowrap", c.city_god_status === "RETURNED" && "font-semibold")}>
                <StatusBadge namespace="cityGodCases.status" value={c.city_god_status} tone={CITY_GOD_STATUS_TONES[c.city_god_status]} />
              </td>
              <td className={cn("px-3 py-2 font-mono text-xs whitespace-nowrap", SUBTLE)}>{formatDateTime(c.created_at)}</td>
            </>
          );
        }}
        page={page}
        totalPages={Math.max(1, Math.ceil(count / PAGE_SIZE))}
        totalCount={count}
        onPageChange={setPage}
      />
      {openId && (
        <CityGodCaseDrawer key={openId} caseId={openId} gods={godList} canTransfer={canTransfer} onClose={() => setOpenId(null)} />
      )}
    </PageShell>
  );
}

export default function CityGodCasesPage() {
  return (
    <RequirePermission permissions="city_god.read" fallback={<PermissionDenied permission="city_god.read" />}>
      <Suspense fallback={null}>
        <CityGodCasesContent />
      </Suspense>
    </RequirePermission>
  );
}
