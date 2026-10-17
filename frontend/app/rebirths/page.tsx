"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { reincarnationApi, type Reincarnation } from "@soulledger/core/api";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { formatSoulCode } from "@soulledger/core/domain/soulCode";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { cn } from "@/lib/utils";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { fieldControl } from "@/src/components/ui/Field";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { SIX_PATHS } from "@/src/components/souls/RebirthFormSelect";
import { rebirthAnchor } from "@/src/components/souls/detail/SoulLedgerSections";

/*
 * 转生登记簿(第四十批 W-c):全殿的转生记录,时间倒序(`Reincarnation.Meta.ordering`)。
 *
 * 筛选只做后端已有的(`ReincarnationViewSet.filterset_fields`):转生形态 `rebirth_form` 是**精确匹配**,
 * 所以这里是单选,不是 Design 的多选;第几世 `cycle_count` 单值。
 * 「第几世」写「第 n → n+1 世」:`cycle_count` 是这次转生**离开**的那一世(第一次转生为 1)。
 * 「去往」是记录上的 `target_realm`(处置所在界域的代码);记录上没有目标文明,所以不画 ⇄。
 * 点一行进灵魂详情,锚点 `#reincarnation-<id>` 滚到这一次转生并高亮(`SoulLedgerSections`)。
 */

function RebirthsContent() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState("");
  const [life, setLife] = useState("");
  const change = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const params: Record<string, string> = { page: String(page) };
  if (form) params.rebirth_form = form;
  if (/^[1-9]\d*$/.test(life)) params.cycle_count = life;
  const isFiltered = Object.keys(params).length > 1;
  const { data, isLoading, isError, refetch, isPlaceholderData } = useQuery({
    queryKey: ["reincarnations", "register", params],
    queryFn: () => reincarnationApi.list(params).then((res) => res.data),
    placeholderData: keepPreviousData,
  });
  const rows = data?.results ?? [];
  const count = data?.count ?? 0;

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("rebirths.title")}
          <MenuGloss path="/rebirths" />
        </>
      }
      subtitle={data ? t("rebirths.total", { n: String(count) }) : undefined}
    >
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <FilterChipSelect
          label={t("rebirths.col_form")}
          value={form}
          options={[
            { value: "", label: t("rebirths.all_forms") },
            ...SIX_PATHS.map((f) => ({ value: f, label: t(`reincarnation.forms.${f}`) })),
          ]}
          clearLabel={t("filter.clear_one", { name: t("rebirths.col_form") })}
          onChange={(v) => change(() => setForm(v))}
        />
        <input
          type="number"
          min={1}
          inputMode="numeric"
          data-testid="rebirths-life"
          aria-label={t("rebirths.col_life")}
          placeholder={t("rebirths.col_life")}
          value={life}
          onChange={(e) => change(() => setLife(e.target.value))}
          className={cn(fieldControl({ size: "md" }), "w-32")}
        />
        {isFiltered && (
          <Button type="button" variant="ghost" size="sm" onClick={() => change(() => { setForm(""); setLife(""); })}>
            {t("filter.clear_all")}
          </Button>
        )}
      </div>
      <DataTable<Reincarnation>
        linkedRows
        caption={t("rebirths.title")}
        columns={[
          { key: "soul", header: t("rebirths.col_soul") },
          { key: "life", header: t("rebirths.col_life") },
          { key: "form", header: t("rebirths.col_form") },
          { key: "to", header: t("rebirths.col_to") },
          { key: "time", header: `${t("rebirths.col_time")} ↓`, align: "right" },
        ]}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isRefreshing={isPlaceholderData}
        isFiltered={isFiltered}
        emptyMessage={t("rebirths.empty")}
        keyExtractor={(r) => r.id}
        renderRow={(r) => (
          <>
            <td className="px-3 py-2 whitespace-nowrap">
              <Link href={`/souls/${r.soul}#${rebirthAnchor(r.id)}`} className={`${ROW_LINK} font-medium text-[oklch(var(--color-ink))]`}>
                {r.soul_name || <MissingValue kind="unrecorded" />}
              </Link>
              {r.soul_code && (
                <span className="ml-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{formatSoulCode(r.soul_code)}</span>
              )}
            </td>
            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
              {t("rebirths.life_value", { from: String(r.cycle_count), to: String(r.cycle_count + 1) })}
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <DomainEnum namespace="reincarnation.forms" value={r.rebirth_form} />
            </td>
            <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-[oklch(var(--color-ink-muted))]">
              {r.target_realm || <MissingValue kind="unrecorded" />}
            </td>
            <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-xs tabular-nums">
              {formatDateTime(r.reincarnated_at)}
            </td>
          </>
        )}
        page={page}
        totalPages={Math.max(1, Math.ceil(count / PAGE_SIZE))}
        totalCount={count}
        onPageChange={setPage}
      />
    </PageShell>
  );
}

export default function RebirthsPage() {
  return (
    <RequirePermission permissions="reincarnation.read" fallback={<PermissionDenied permission="reincarnation.read" />}>
      <RebirthsContent />
    </RequirePermission>
  );
}
