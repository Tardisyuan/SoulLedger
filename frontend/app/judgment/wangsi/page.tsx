"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { officerAppApi, type TodoItem } from "@soulledger/core/api/officer-app";
import { todoKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { DataTable, ROW_LINK, type DataTableColumn } from "@/components/ui/data-table";

/*
 * 枉死申诉(2026-11-16,官员端 App「待我处理 · 枉死申诉」在网页上的那一张表;Design 未画,沿用城隍初审队列的版式)。
 * 数据就是 App 读的那一组:`/officer-app/todo/?kind=wangsi&offset=…`(我名下城隍的枉死案子里待审 FILED 的,先申诉的在前,
 * 一页 10 条 —— 服务端 `LIST_LIMIT`)。没有别的列表接口,所以殿管理员不在任何城隍名下时这里是空的。
 * 审核不在这页:每行到审判页,枉死城块里的「属实 / 不属实」照旧(`DiyuCaseFields`)。
 */

const PAGE = 10;
const SUBTLE = "text-[oklch(var(--color-ink-subtle))]";

function WangsiContent() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: [...todoKeys.item("wangsi-list"), page],
    queryFn: () => officerAppApi.todoGroup("wangsi", (page - 1) * PAGE).then((r) => r.data),
    placeholderData: (previous) => previous,
  });
  const rows = list.data?.items ?? [];
  const count = list.data?.count ?? 0;

  const columns: DataTableColumn[] = [
    { key: "soul", header: t("judgment.soul_name"), pinned: true },
    { key: "city_god", header: t("cityGods.title") },
    { key: "level", header: t("judgment.wangsi.level") },
    { key: "filed", header: t("judgment.wangsi.filed_at") },
  ];

  return (
    <PageShell variant="full" title={t("judgment.wangsi.queue_title")} subtitle={t("judgment.wangsi.queue_hint")}>
      <DataTable<TodoItem>
        linkedRows
        caption={t("judgment.wangsi.queue_title")}
        columns={columns}
        data={rows}
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => list.refetch()}
        isRefreshing={list.isPlaceholderData}
        skeletonRows={3}
        emptyMessage={t("judgment.wangsi.error.no_grievance_filed")}
        keyExtractor={(r) => r.id}
        renderRow={(r) => (
          <>
            <td className="px-3 py-2 text-sm">
              <Link href={`/judgment/${r.target.id}`} className={ROW_LINK} data-testid={`wangsi-row-${r.id}`}>
                {r.title}
              </Link>
            </td>
            <td className="px-3 py-2 text-sm whitespace-nowrap">{r.city_god_name}</td>
            <td className="px-3 py-2 text-sm whitespace-nowrap">
              {r.grievance_level ? (
                <DomainEnum namespace="judgment.grievance_levels" value={r.grievance_level} />
              ) : (
                <span className={SUBTLE}>{t("judgment.wangsi.unset")}</span>
              )}
            </td>
            <td className={`px-3 py-2 font-mono text-xs whitespace-nowrap ${SUBTLE}`}>{formatDateTime(r.created_at)}</td>
          </>
        )}
        page={page}
        totalPages={Math.max(1, Math.ceil(count / PAGE))}
        totalCount={count}
        onPageChange={setPage}
      />
    </PageShell>
  );
}

export default function WangsiGrievancesPage() {
  return (
    <RequirePermission permissions="wangsi.execute" fallback={<PermissionDenied permission="wangsi.execute" />}>
      <WangsiContent />
    </RequirePermission>
  );
}
