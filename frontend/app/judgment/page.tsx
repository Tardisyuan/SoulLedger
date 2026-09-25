"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { judgmentApi, PAGE_SIZE, type Judgment } from "@soulledger/core/api";
import { DataTable, parseOrdering, ROW_LINK } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { buttonVariants } from "@/src/components/ui/Button";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { Kbd } from "@/src/components/judgment/JudgmentDesk";
import { useHotkeys } from "@/src/lib/hotkeys";
import { verdictGlyph, verdictInk } from "@/src/lib/verdictGlyph";
import { JudgmentClaimQueue } from "@/src/components/judgment/JudgmentClaimQueue";

/**
 * 审判队列(规范 v1 第三类 A·02)。
 *
 * 「待审」一面按「谁在处理」分组 —— 我认领 / 待认领 / 他人认领 / 暂缓 —— 带勾选列与批量条
 * (认领 / 改派 / 暂缓)、搜索与殿筛选、余额与证据两列;见 `JudgmentClaimQueue`。认领人
 * (`claimed_by`)是正在办这件案子的操作员,不是 `judge` —— 后者是神话里的判官(阎罗王、米诺斯)。
 *
 * 「已结案」一面仍是一张平表:它回答「判过什么」,没有谁在办的问题。分段切换带两边的真实计数,
 * 「进入队列」主按钮与 Q 键不变。
 */

type Tab = "pending" | "concluded";

function JudgmentQueuePageContent() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState("");

  const listQuery = (which: Tab, p: number) => ({
    queryKey: ["judgments", which, p, ordering],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(p) };
      params.has_verdict = which === "pending" ? "false" : "true";
      if (ordering) params.ordering = ordering;
      const res = await judgmentApi.list(params);
      return res.data;
    },
  });
  // Params live in the queryKey, so tab/page/ordering changes refetch on their own.
  const { data: judgmentData, isLoading, isError, refetch } = useQuery(listQuery(tab, page));
  // 另一段只为分段切换上的计数:取它的第一页(与切过去时第一眼看到的是同一份缓存)。
  const other: Tab = tab === "pending" ? "concluded" : "pending";
  const { data: otherData } = useQuery(listQuery(other, 1));
  const counts: Record<Tab, number | undefined> = {
    [tab]: judgmentData?.count,
    [other]: otherData?.count,
  } as Record<Tab, number | undefined>;

  const judgments = judgmentData?.results ?? [];
  const totalPages = judgmentData ? Math.ceil(judgmentData.count / PAGE_SIZE) : 0;

  useHotkeys({ q: () => router.push("/judgment/queue") });

  const pending = tab === "pending";

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("judgment.title")}
          <MenuGloss path="/judgment" />
        </>
      }
      actions={
        /* The list answers "which judgments exist"; the queue (§4.2) answers
           "what do I decide next". An anchor, not a Button — it navigates. */
        <Link href="/judgment/queue" className={`${buttonVariants({ variant: "primary", size: "md" })} gap-2`}>
          {t("judgment.queue.enter")}
          <Kbd>Q</Kbd>
        </Link>
      }
      tabs={
        /* 分段切换 Segmented:当前 = 墨底。`aria-pressed`,不是 role="tab" —— 它不控制
           一组 tabpanel,只换同一张表的问题(同 app/notifications 那条的理由)。 */
        <div className="my-2 inline-flex border border-[oklch(var(--color-block))] text-xs">
          {(["pending", "concluded"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => { setTab(key); setPage(1); }}
              className={`flex items-center gap-2 px-3 py-1 ${
                tab === key
                  ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                  : "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
              }`}
            >
              {t(key === "pending" ? "judgment.pending" : "judgment.concluded")}
              {counts[key] !== undefined && <span className="font-mono tabular-nums">{counts[key]}</span>}
            </button>
          ))}
        </div>
      }
    >
      {pending ? (
        <JudgmentClaimQueue />
      ) : (
      <DataTable<Judgment>
        density="compact"
        linkedRows
        caption={t("judgment.title")}
        columns={[
          { key: "soul_name", header: t("judgment.soul_name") },
          { key: "civilization", header: t("judgment.civilization") },
          { key: "court", header: t("judgment.court") },
          { key: "verdict", header: t("judgment.verdict") },
          {
            key: "created_at",
            header: t("judgment.created"),
            sortable: true,
            align: "right" as const,
          },
        ]}
        data={judgments}
        /* Tab, page and sort — the three things that make this a different
           question. A `JUDGMENT_CONCLUDED` pushed by another operator moves a
           row between the two tabs without any of them changing, which is the
           case this exists to show. */
        transitionKey={`${tab}|${page}|${ordering}`}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        keyExtractor={(judgment) => String(judgment.id)}
        renderRow={(judgment) => {
          const bench = [judgment.court, judgment.judge_name].filter(Boolean).join(" · ");
          return (
            <>
              <td className="px-3 font-medium text-[oklch(var(--color-ink))] whitespace-nowrap max-w-64 truncate" title={judgment.soul_name || undefined}>
                <Link href={`/judgment/${judgment.id}`} className={ROW_LINK}>
                  {/* `MissingValue`,不是 UUID:`soul_name || soul` 在名字缺失时把主键印成
                      灵魂名 —— 兜底方向违反 IDENTIFIER_POLICY。 */}
                  {judgment.soul_name ? (
                    judgment.soul_name
                  ) : (
                    <MissingValue kind="unrecorded" reason="soul_name 未随判决返回" />
                  )}
                </Link>
              </td>
              <td className="px-3 text-xs text-[oklch(var(--color-ink-muted))] whitespace-nowrap">
                <DomainEnum namespace="souls.civilizations" value={judgment.civilization} />
              </td>
              <td className="px-3 text-xs text-[oklch(var(--color-ink-muted))] whitespace-nowrap max-w-64 truncate" title={bench || undefined}>
                {bench || <MissingValue kind="unrecorded" />}
              </td>
              <td className={`px-3 text-xs whitespace-nowrap ${verdictInk(judgment.verdict)}`}>
                {judgment.verdict && (
                  <>
                    <span aria-hidden="true">{verdictGlyph(judgment.verdict)} </span>
                    <DomainEnum namespace="judgment.verdicts" value={judgment.verdict} />
                  </>
                )}
              </td>
              <td className="px-3 text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))] whitespace-nowrap">
                {formatDate(judgment.concluded_at ?? judgment.created_at)}
              </td>
            </>
          );
        }}
        sort={parseOrdering(ordering)}
        onSortChange={(next) => {
          setOrdering(next ? `${next.direction === "desc" ? "-" : ""}${next.key}` : "");
          setPage(1);
        }}
        emptyMessage={t("judgment.no_judgments")}
        page={page}
        totalPages={totalPages}
        totalCount={judgmentData?.count}
        onPageChange={setPage}
      />
      )}
    </PageShell>
  );
}


/* 页级门。后端才是正解(这几个 viewset 都挂了 `CodenamePermission`),这里是纵深:
   侧边栏的菜单过滤**只藏链接、不挡路由**,所以在补上这道门之前,直接输 URL 就能
   打开一个功能完整的页面。码名与后端 `permission_codename` 对齐,不是猜的角色名 ——
   `tests/test_page_gates_match_the_backend.py` 会因为路由没有门而红。 */
export default function JudgmentQueuePage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied />}>
      <JudgmentQueuePageContent />
    </RequirePermission>
  );
}
