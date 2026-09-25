"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { judgmentApi, PAGE_SIZE } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { verdictGlyph, verdictInk } from "@/src/lib/verdictGlyph";

/**
 * 语料页右栏「被引用」清单:`GET /judgment/?statute=<id>&ordering=-created_at`,分页。
 *
 * 件数(`citation_count`)与这张清单算在同一个集合上 —— 调用者的判决列表(租户 + 行级
 * DataScope,见 `apps/judgment/views.py::visible_judgments`),所以两者不会对不上。
 * 父组件按律条 `key` 挂它,换一条律条时页码归一。
 */
export function CorpusCitedBy({ statuteId }: { statuteId: string }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: [...judgmentKeys.all, "cited-by", statuteId, page],
    queryFn: () =>
      judgmentApi
        .list({ statute: statuteId, ordering: "-created_at", page: String(page) })
        .then((r) => r.data),
  });
  if (isError) return <p className="py-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.corpus.cited_by_error")}</p>;
  if (isLoading || !data) return <p className="py-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</p>;
  if (data.results.length === 0) return null;
  const pages = Math.max(1, Math.ceil(data.count / PAGE_SIZE));
  return (
    <div data-testid="corpus-cited-list">
      <ul>
        {data.results.map((j) => (
          <li key={j.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1.5 border-b border-[oklch(var(--color-rule))]">
            <Link href={`/judgment/${j.id}`} className="min-w-0 truncate text-sm text-[oklch(var(--color-ink))] hover:underline" title={j.soul_name || undefined}>
              <DomainText value={j.soul_name} />
            </Link>
            <span className={`justify-self-end font-mono text-2xs whitespace-nowrap ${verdictInk(j.verdict)}`}>
              {j.verdict ? (
                <>
                  <span aria-hidden="true">{verdictGlyph(j.verdict)} </span>
                  <DomainEnum namespace="judgment.verdicts" value={j.verdict} />
                </>
              ) : (
                t("judgment.corpus.cited_by_open")
              )}
            </span>
            <span className="col-span-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
              {(j.concluded_at ?? j.created_at).slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-between pt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹ {t("common.prev")}
          </Button>
          <span>{page} / {pages}</span>
          <Button type="button" variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")} ›
          </Button>
        </div>
      )}
    </div>
  );
}
