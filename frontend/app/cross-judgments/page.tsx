"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PAGE_SIZE } from "@soulledger/core/api/client";
import Link from "next/link";
import { crossTenantJudgmentsApi, type CrossTenantJudgmentListItem } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageSection } from "@/components/ui/page-section";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { type BadgeTone } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";

/**
 * Case state → badge tone.
 *
 * A TONE and not a token: the four members here describe how a joint case is
 * progressing, which is what the feedback layer means, but naming
 * `--color-status-*` in a map keyed by a domain enumeration is the exact shape
 * `src/__tests__/statusTokenLayering.test.ts` polices. Going through a tone
 * keeps the indirection the tone table was built for — the same route
 * `ENUM_TONE_CLASSES` takes in the shared data grid — instead of adding a
 * fifth hand-rolled offender to that file's register.
 *
 * CANCELLED is `neutral` rather than `error`: a case withdrawn is not a case
 * that failed.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  PROPOSED: "warning",
  ACTIVE: "info",
  CONCLUDED: "success",
  CANCELLED: "neutral",
};

/*
 * The `t("…") || "English fallback"` spellings that used to be here are gone.
 * `useI18n`'s `t()` returns the KEY when it cannot resolve one, and a key is a
 * non-empty string — so the right-hand side was unreachable, and it read as
 * i18n coverage that did not exist. Both keys resolve; nothing changed on
 * screen. Three other files carry a comment diagnosing this exact shape.
 */
export default function CrossJudgmentsPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  /**
   * Was `list()` with no `page` param and no pagination control, while the
   * server paginates at 20 (`packages/core/src/api/client.ts:28`) — so a tenant with more
   * than twenty cross-tenant cases had the rest invisible and unreachable,
   * with nothing on screen saying so.
   */
  const [page, setPage] = useState(1);
  const { data: pageData, isLoading, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ["cross-judgments", page],
    queryFn: () => crossTenantJudgmentsApi.list({ page: String(page) }).then(r => r.data),
    placeholderData: (previous) => previous,
    enabled: !!user,
  });
  const judgments = pageData?.results ?? [];

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("crossJudgments.title")}
          <MenuGloss path="/cross-judgments" />
        </>
      }
      subtitle={t("crossJudgments.subtitle")}
    >
      <PageSection title={t("crossJudgments.list_title")}>
        {/* 账页表格(规范 v1 §2):整行点进 /cross-judgments/[id]。失败与空仍分开 ——
            DataTable 的失败行是「! 加载失败」+ 重试,不会落到「暂无」。
            `placeholderData` 让翻页时 `isLoading` 不再为真,所以翻页中的那一段交给
            `isRefreshing`(变淡 + aria-busy),不是什么都不发生。 */}
        <DataTable<CrossTenantJudgmentListItem>
          linkedRows
          caption={t("crossJudgments.list_title")}
          columns={[
            { key: "title", header: t("crossJudgments.case_title") },
            { key: "initiated_by", header: t("crossJudgments.initiated_by") },
            { key: "status", header: t("crossJudgments.status_label") },
          ]}
          data={judgments}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          isRefreshing={isPlaceholderData}
          skeletonRows={3}
          emptyMessage={t("crossJudgments.no_judgments")}
          keyExtractor={(j) => String(j.id)}
          renderRow={(j) => (
            <>
              <td className="px-3 py-2 font-medium text-[oklch(var(--color-ink))]">
                <Link href={`/cross-judgments/${j.id}`} className={ROW_LINK}>
                  {j.title}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                {j.initiating_tenant_code}
              </td>
              <td className="px-3 py-2">
                <StatusBadge namespace="crossJudgments.states" value={j.status} tone={STATUS_TONES[j.status] ?? "neutral"} />
              </td>
            </>
          )}
          page={page}
          totalPages={Math.max(1, Math.ceil((pageData?.count ?? 0) / PAGE_SIZE))}
          totalCount={pageData?.count ?? 0}
          onPageChange={setPage}
        />
      </PageSection>
    </PageShell>
  );
}
