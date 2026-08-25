"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { judgmentApi, PAGE_SIZE, type Judgment } from "@/lib/api";
import { DataTable, parseOrdering, type SortState } from "@/components/ui/data-table";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { buttonVariants } from "@/src/components/ui/Button";

/**
 * Verdicts keep the `--color-verdict-*` palette rather than moving onto
 * `Badge`'s five tones. The tones are the system-feedback layer (success /
 * warning / error), and `src/__tests__/statusTokenLayering.test.ts` is an
 * entire file about not painting domain enums with it: PASSED is not "success",
 * it is a judgement on a soul. So the geometry comes from `Badge` — which is
 * also the only place allowed the 2px vertical padding a badge needs — and the
 * fill/ink come from this map through `className`.
 */
const VERDICT_COLORS: Record<string, string> = {
  PASSED: "bg-[hsl(var(--color-verdict-passed)/0.1)] text-[hsl(var(--color-verdict-passed))]",
  FAILED: "bg-[hsl(var(--color-verdict-failed)/0.1)] text-[hsl(var(--color-verdict-failed))]",
  PURGATORY: "bg-[hsl(var(--color-verdict-purgatory)/0.1)] text-[hsl(var(--color-verdict-purgatory))]",
  RETRY: "bg-[hsl(var(--color-verdict-retry)/0.1)] text-[hsl(var(--color-verdict-retry))]",
};

export default function JudgmentQueuePage() {
  const { t, formatDate } = useI18n();
  const [tab, setTab] = useState<"pending" | "concluded">("pending");
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState("");

  // Fetch judgments with filter based on tab.
  // Params live in the queryKey, so tab/page/ordering changes refetch on their own.
  const {
    data: judgmentData,
    isLoading: judgmentLoading,
    isError: judgmentIsError,
  } = useQuery({
    queryKey: ["judgments", tab, page, ordering],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page) };
      params.has_verdict = tab === "pending" ? "false" : "true";
      if (ordering) params.ordering = ordering;
      const res = await judgmentApi.list(params);
      return res.data;
    },
  });

  // Paginated list — `results` is always present, so the `?? judgmentData`
  // fallback the expression used to carry was unreachable.
  const judgments = judgmentData?.results ?? [];
  const totalPages = judgmentData ? Math.ceil(judgmentData.count / PAGE_SIZE) : 0;

  const tabs = [
    { key: "pending", label: t("judgment.pending") },
    { key: "concluded", label: t("judgment.concluded") },
  ] as const;

  return (
    /* `page` (1200px). The list was clamped to 1024 by a `max-w-5xl` it chose
       for itself; six columns are wider than that judgement allowed for. */
    <PageShell
      variant="page"
      title={
        <>
          {t("judgment.title")}
          <MenuGloss path="/judgment" />
        </>
      }
      actions={
        /* The list answers "which judgments exist"; the queue (§4.2) answers
           "what do I decide next". This is how an operator enters it. An
           anchor, not a Button — it navigates — so it borrows the button's
           class recipe rather than its element. */
        <Link href="/judgment/queue" className={buttonVariants({ variant: "primary", size: "md" })}>
          {t("judgment.queue.enter")}
        </Link>
      }
      tabs={tabs.map((tabItem) => (
        <button
          key={tabItem.key}
          type="button"
          onClick={() => { setTab(tabItem.key); setPage(1); }}
          className={`px-4 py-2 text-03 font-medium transition-colors border-b-2 -mb-px ${
            tab === tabItem.key
              ? "text-[hsl(var(--color-accent-ink))] border-accent"
              : "text-ink-muted border-transparent hover:text-ink"
          }`}
        >
          {tabItem.label}
        </button>
      ))}
    >
      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the bottom. */}
      <DataTable<Judgment>
        caption={t("judgment.title")}
        columns={[
          { key: "soul_name", header: t("judgment.soul_name") },
          { key: "civilization", header: t("judgment.civilization") },
          { key: "court", header: t("judgment.court") },
          { key: "verdict", header: t("judgment.verdict") },
          { key: "created_at", header: t("judgment.created"), sortable: true },
          { key: "action", header: t("judgment.action") },
        ]}
        data={judgments}
        isLoading={judgmentLoading}
        isError={judgmentIsError}
        keyExtractor={(judgment) => String(judgment.id)}
        renderRow={(judgment) => (
          <>
            <td className="px-4 py-3 text-03 font-medium text-ink">
              {judgment.soul_name || judgment.soul}
            </td>
            <td className="px-4 py-3 text-03 text-ink-muted">
              <DomainEnum namespace="souls.civilizations" value={judgment.civilization} />
            </td>
            <td className="px-4 py-3 text-03 text-ink-muted">
              {judgment.court}
            </td>
            <td className="px-4 py-3">
              {judgment.verdict ? (
                <Badge className={VERDICT_COLORS[judgment.verdict]}>
                  <DomainEnum namespace="judgment.verdicts" value={judgment.verdict} />
                </Badge>
              ) : (
                /* JUDGING is a soul-lifecycle state, not a system verdict —
                   hence `--color-status-judging` rather than a Badge tone. */
                <Badge className="bg-[hsl(var(--color-status-judging)/0.1)] text-[hsl(var(--color-status-judging))]">
                  {t("judgment.pending")}
                </Badge>
              )}
            </td>
            {/* 02 档：日期是元数据，不是正文。 */}
            <td className="px-4 py-3 text-02 text-ink-muted">
              {formatDate(judgment.created_at)}
            </td>
            <td className="px-4 py-3">
              <Link
                href={`/judgment/${judgment.id}`}
                className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline"
              >
                {t("judgment.view")} →
              </Link>
            </td>
          </>
        )}
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
    </PageShell>
  );
}
