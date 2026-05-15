"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { judgmentApi, soulsApi, type Judgment, type Soul } from "@/lib/api";
import { TableSkeleton } from "@/components/ui/skeleton";

const VERDICT_COLORS: Record<string, string> = {
  PASSED: "bg-green-500/20 text-green-400",
  FAILED: "bg-red-500/20 text-red-400",
  PURGATORY: "bg-amber-500/20 text-amber-400",
  RETRY: "bg-blue-500/20 text-blue-400",
};

export default function JudgmentQueuePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"pending" | "concluded">("pending");

  // Fetch judgments with filter based on tab
  const {
    data: judgmentData,
    isLoading: judgmentLoading,
    error: judgmentError,
  } = useQuery({
    queryKey: ["judgments", tab],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (tab === "pending") {
        params.has_verdict = "false";
      } else {
        params.has_verdict = "true";
      }
      const res = await judgmentApi.list(params);
      return res.data;
    },
  });

  // Fetch all souls to map IDs to names
  const { data: soulsData } = useQuery({
    queryKey: ["souls-all"],
    queryFn: async () => {
      const res = await soulsApi.list();
      return res.data;
    },
  });

  const judgments = (judgmentData?.results ?? judgmentData ?? []) as Judgment[];
  const souls = (soulsData?.results ?? soulsData ?? []) as Soul[];

  // Build soul ID -> name map
  const soulNameMap: Record<string, string> = {};
  for (const soul of souls) {
    soulNameMap[soul.id] = soul.name;
  }

  const tabs = [
    { key: "pending", label: t("judgment.pending") },
    { key: "concluded", label: t("judgment.concluded") },
  ] as const;

  return (
    <div className="text-ink">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <Link href="/" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("judgment.title")}
        </h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-hairline/50">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t.key
                  ? "text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent))]"
                  : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Loading / Error / Empty / Table */}
        {judgmentLoading ? (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.soul_name")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.civilization")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.court")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.verdict")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.created")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.action")}
                  </th>
                </tr>
              </thead>
            </table>
            <div className="p-4">
              <TableSkeleton rows={5} cols={6} />
            </div>
          </div>
        ) : judgmentError ? (
          <div className="text-center text-red-400 py-12">
            {String(judgmentError)}
          </div>
        ) : judgments.length === 0 ? (
          <div className="text-center text-ink-subtle py-12">
            {t("judgment.no_judgments")}
          </div>
        ) : (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.soul_name")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.civilization")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.court")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.verdict")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.created")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    {t("judgment.action")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                {judgments.map((judgment) => (
                  <tr
                    key={judgment.id}
                    className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[hsl(var(--color-ink))]">
                      {soulNameMap[judgment.soul] || judgment.soul}
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
                            "bg-surface-3 text-ink-muted"
                          }`}
                        >
                          {t(`judgment.verdicts.${judgment.verdict}`)}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-400">
                          {t("judgment.pending")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">
                      {new Date(judgment.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/judgment/${judgment.id}`}
                        className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent))] text-sm"
                      >
                        {t("judgment.view")} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
