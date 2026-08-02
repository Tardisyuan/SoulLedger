"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { judgmentApi, type Judgment } from "@/lib/api";
import { DataTable, type SortState } from "@/components/ui/data-table";

const VERDICT_COLORS: Record<string, string> = {
  PASSED: "bg-[hsl(var(--color-verdict-passed)/0.2)] text-[hsl(var(--color-verdict-passed))]",
  FAILED: "bg-[hsl(var(--color-verdict-failed)/0.2)] text-[hsl(var(--color-verdict-failed))]",
  PURGATORY: "bg-[hsl(var(--color-verdict-purgatory)/0.2)] text-[hsl(var(--color-verdict-purgatory))]",
  RETRY: "bg-[hsl(var(--color-verdict-retry)/0.2)] text-[hsl(var(--color-verdict-retry))]",
};

/** Parses the `ordering` query param ("-created_at" etc.) into DataTable's sort shape. */
function parseOrdering(ordering: string): SortState | null {
  if (!ordering) return null;
  const desc = ordering.startsWith("-");
  return { key: desc ? ordering.slice(1) : ordering, direction: desc ? "desc" : "asc" };
}

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

  const judgments = (judgmentData?.results ?? judgmentData ?? []) as Judgment[];
  const totalPages = judgmentData ? Math.ceil(judgmentData.count / 20) : 0;

  const tabs = [
    { key: "pending", label: t("judgment.pending") },
    { key: "concluded", label: t("judgment.concluded") },
  ] as const;

  return (
    <div className="text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("judgment.title")}
        </h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-[hsl(var(--color-hairline))]/50">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => { setTab(tabItem.key); setPage(1); }}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === tabItem.key
                  ? "text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent))]"
                  : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

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
              <td className="px-4 py-3 font-medium text-[hsl(var(--color-ink))]">
                {judgment.soul_name || judgment.soul}
              </td>
              <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">
                {t(`souls.civilizations.${judgment.civilization}`)}
              </td>
              <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">
                {judgment.court}
              </td>
              <td className="px-4 py-3">
                {judgment.verdict ? (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      VERDICT_COLORS[judgment.verdict] ??
                      "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"
                    }`}
                  >
                    {t(`judgment.verdicts.${judgment.verdict}`)}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-[hsl(var(--color-status-judging)/0.2)] text-[hsl(var(--color-status-judging))]">
                    {t("judgment.pending")}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))] text-xs">
                {formatDate(judgment.created_at)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/judgment/${judgment.id}`}
                  className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent))] text-sm"
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
      </div>
    </div>
  );
}
