"use client";

import { MissingValue } from "@/src/components/ui/DomainValue";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import { judgmentAppealKeys, judgmentAppealsApi, type JudgmentAppeal } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { CaseNumber } from "@/src/components/ui/DomainValue";
import { DataTable, ROW_LINK, type DataTableColumn } from "@/components/ui/data-table";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";
import { APPEAL_STATUS_TONES } from "@/src/components/judgment/appealDisplay";

/*
 * 申诉复核队列(Design 第五十二批 W-1)。四个页签:待复核(默认)/ 复核中 / 已结案(维持 + 改判,行里写是哪一种)/ 已撤回。
 * 按提出时间先到先排。「距截止」灰字,只供参考 —— 申诉已经交上来了。复核人只在「复核中」有值。
 */

type Tab = "PENDING" | "IN_REVIEW" | "CLOSED" | "WITHDRAWN";
const TABS: Tab[] = ["PENDING", "IN_REVIEW", "CLOSED", "WITHDRAWN"];
const MUTED = "text-xs text-[oklch(var(--color-ink-subtle))] whitespace-nowrap";

/** 「已结案」是维持与改判两种,一次 `status__in` 取。 */
const TAB_FILTER: Record<Tab, Record<string, string>> = {
  PENDING: { status: "PENDING" },
  IN_REVIEW: { status: "IN_REVIEW" },
  CLOSED: { status__in: "UPHELD,AMENDED,VOID" },
  WITHDRAWN: { status: "WITHDRAWN" },
};

function AppealQueueContent() {
  const { t, formatDate, formatDateTime } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const [tab, setTab] = useState<Tab>("PENDING");
  const [page, setPage] = useState(1);
  const params = { tab, page: String(page) };
  const list = useQuery({
    queryKey: judgmentAppealKeys.list(params),
    queryFn: () =>
      judgmentAppealsApi.list({ ...TAB_FILTER[tab], page: String(page), ordering: "create_time" }).then((r) => r.data),
    placeholderData: (previous) => previous,
  });
  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const pages = Math.ceil(count / PAGE_SIZE);
  const tabLabel = (tb: Tab) => (tb === "CLOSED" ? t("judgment.concluded") : t(`appeals.status.${tb}`));

  const columns: DataTableColumn[] = [
    { key: "case", header: t("judgment.case_number"), pinned: true },
    { key: "soul", header: t("judgment.queue.identity") },
    { key: "round", header: t("appeals.col.round") },
    { key: "filed_at", header: t("appeals.col.filed_at") },
    { key: "deadline", header: t("appeals.col.deadline") },
    ...(tab === "IN_REVIEW" ? [{ key: "reviewer", header: t("appeals.col.reviewer") }] : []),
    ...(tab === "CLOSED" ? [{ key: "status", header: t("judgment.concluded") }] : []),
  ];

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("appeals.queue_title")}
          <MenuGloss path="/judgment/appeals" />
        </>
      }
      tabs={
        <>
          {TABS.map((tb) => (
            <button
              key={tb}
              type="button"
              data-testid={`appeal-tab-${tb}`}
              aria-pressed={tab === tb}
              onClick={() => {
                setTab(tb);
                setPage(1);
              }}
              className={`${TAB_BASE} ${tab === tb ? TAB_ON : TAB_OFF}`}
            >
              {tabLabel(tb)}
            </button>
          ))}
        </>
      }
    >
      <DataTable<JudgmentAppeal>
        linkedRows
        caption={`${t("appeals.queue_title")} · ${tabLabel(tab)}`}
        columns={columns}
        data={rows}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => list.refetch()}
        isRefreshing={list.isPlaceholderData}
        skeletonRows={3}
        emptyMessage={tab === "PENDING" ? t("appeals.queue_empty") : t("table.empty")}
        keyExtractor={(a) => a.id}
        renderRow={(a) => {
          return (
            <>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link href={`/judgment/appeals/${a.id}`} className={ROW_LINK}>
                  <CaseNumber value={a.case_number} variant="inline" />
                </Link>
              </td>
              <td className="px-3 py-2 text-sm whitespace-nowrap text-[oklch(var(--color-ink))]">{a.soul_name}</td>
              <td className="px-3 py-2 text-sm whitespace-nowrap">{t("appeals.round", { round: String(a.round) })}</td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">{formatDateTime(a.create_time)}</td>
              <td className={MUTED} data-appeal-deadline="">{a.deadline ? formatDate(a.deadline) : <MissingValue kind="unrecorded" />}</td>
              {tab === "IN_REVIEW" && <td className="px-3 py-2 text-sm whitespace-nowrap">{a.reviewer_name ?? <MissingValue kind="unrecorded" />}</td>}
              {tab === "CLOSED" && (
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusBadge namespace="appeals.status" value={a.status} tone={APPEAL_STATUS_TONES[a.status]} />
                </td>
              )}
            </>
          );
        }}
        page={page}
        totalPages={Math.max(1, pages)}
        totalCount={count}
        onPageChange={setPage}
      />
    </PageShell>
  );
}

export default function AppealQueuePage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      <AppealQueueContent />
    </RequirePermission>
  );
}
