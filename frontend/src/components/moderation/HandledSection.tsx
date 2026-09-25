"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { HandledContent, HandledFilters } from "@soulledger/core/api/social-moderation";
import { useHandledContent, useModeratedItem, useRestoreVisible } from "@soulledger/core/hooks/useSocialModeration";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { Drawer } from "@/src/components/ui/Drawer";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";
import { useFailureToast } from "./shared";

const HANDLING_TONE = { HIDDEN: "warning", DELETED: "error" } as const;

/**
 * 已处理(E-08d):被隐藏或被官员删除的帖子与评论。
 *
 * No row-end button: 恢复可见 is not this list's daily work. The whole row
 * opens the review detail read-only (a drawer, J / K between rows), and only
 * there does a HIDDEN item offer 「恢复可见」. A DELETED item is in the recycle
 * bin, so the detail says 「在回收站」 and links there — a second restore path
 * here would be a second set of rules for the same act.
 */
export function HandledSection() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<HandledContent["type"] | "">("");
  const [handling, setHandling] = useState<HandledContent["handling"] | "">("");
  const filters: HandledFilters = { ...(page > 1 ? { page } : {}), ...(type ? { type } : {}), ...(handling ? { handling } : {}) };
  const list = useHandledContent(filters);
  const rows = list.data?.results ?? [];
  const restore = useRestoreVisible();

  const [openId, setOpenId] = useState<string | null>(null);
  const lastOpen = useRef<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const openIndex = rows.findIndex((r) => `${r.type}:${r.id}` === openId);
  const open = openIndex >= 0 ? rows[openIndex] : null;
  const step = (d: number) => {
    const next = rows[openIndex + d];
    return next ? () => show(`${next.type}:${next.id}`) : undefined;
  };
  const show = (key: string) => {
    lastOpen.current = key;
    setOpenId(key);
  };

  const kind = open?.type === "COMMENT" ? "comments" : "posts";
  const item = useModeratedItem(kind, open && open.handling === "HIDDEN" ? open.id : null);

  const all = t("filter.all");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChipSelect
          label={t("social_moderation.handled.col_type")}
          value={type}
          options={[
            { value: "", label: all },
            { value: "POST", label: t("social_moderation.target_type.POST") },
            { value: "COMMENT", label: t("social_moderation.target_type.COMMENT") },
          ]}
          clearLabel={t("filter.clear_one", { name: t("social_moderation.handled.col_type") })}
          onChange={(v) => {
            setType(v as HandledContent["type"] | "");
            setPage(1);
          }}
        />
        <FilterChipSelect
          label={t("social_moderation.handled.col_handling")}
          value={handling}
          options={[
            { value: "", label: all },
            { value: "HIDDEN", label: t("social_moderation.handling.HIDDEN") },
            { value: "DELETED", label: t("social_moderation.handling.DELETED") },
          ]}
          clearLabel={t("filter.clear_one", { name: t("social_moderation.handled.col_handling") })}
          onChange={(v) => {
            setHandling(v as HandledContent["handling"] | "");
            setPage(1);
          }}
        />
      </div>

      <DataTable<HandledContent>
        caption={t("social_moderation.tabs.handled")}
        density="compact"
        linkedRows
        columns={[
          { key: "type", header: t("social_moderation.handled.col_type"), width: "72px" },
          { key: "author", header: t("social_moderation.fields.author") },
          { key: "content", header: t("social_moderation.fields.content") },
          { key: "handling", header: t("social_moderation.handled.col_handling") },
          { key: "reason", header: t("social_moderation.fields.reason") },
          { key: "by", header: t("social_moderation.handled.col_by") },
          { key: "at", header: t("social_moderation.fields.created"), align: "right" },
        ]}
        data={rows}
        isLoading={list.isLoading}
        isError={list.isError && !list.data}
        onRetry={() => list.refetch()}
        isFiltered={Boolean(type || handling)}
        onClearFilters={() => {
          setType("");
          setHandling("");
          setPage(1);
        }}
        emptyMessage={t("social_moderation.empty.handled")}
        keyExtractor={(r) => `${r.type}:${r.id}`}
        renderRow={(r) => (
          <>
            <td className="px-3 py-2">
              <Badge tone="neutral">{t(`social_moderation.target_type.${r.type}`)}</Badge>
            </td>
            <td className="px-3 py-2 font-medium text-[oklch(var(--color-ink))]">
              {/* The row's one control: its ::after covers the row (ROW_LINK). */}
              <button
                type="button"
                ref={(el) => {
                  const key = `${r.type}:${r.id}`;
                  if (el) openers.current.set(key, el);
                  else openers.current.delete(key);
                }}
                onClick={() => show(`${r.type}:${r.id}`)}
                className={`${ROW_LINK} text-left`}
              >
                {r.author?.display_name}
              </button>
            </td>
            <td title={r.excerpt} className="max-w-[40ch] truncate px-3 py-2 font-serif text-sm text-[oklch(var(--color-ink))]">{r.excerpt}</td>
            <td className="px-3 py-2">
              <Badge tone={HANDLING_TONE[r.handling]}>{t(`social_moderation.handling.${r.handling}`)}</Badge>
            </td>
            <td className="px-3 py-2 text-xs text-[oklch(var(--color-ink-muted))]">{r.reason || <MissingValue kind="unrecorded" />}</td>
            <td className="px-3 py-2 text-xs text-[oklch(var(--color-ink-muted))]">{r.handled_by?.display_name ?? <MissingValue kind="unrecorded" />}</td>
            <td className="px-3 py-2 text-right font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
              {r.handled_at ? formatDateTime(r.handled_at) : <MissingValue kind="unrecorded" />}
            </td>
          </>
        )}
        page={page}
        totalPages={list.data ? Math.ceil(list.data.count / PAGE_SIZE) : 0}
        totalCount={list.data?.count}
        onPageChange={setPage}
      />

      <Drawer
        isOpen={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.author?.display_name ?? ""}
        hint={t("souls.preview.hint")}
        onNext={step(1)}
        onPrev={step(-1)}
        finalFocus={() => openers.current.get(lastOpen.current ?? "") ?? null}
      >
        {open && (
          <div data-handled-detail={open.id} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{t(`social_moderation.target_type.${open.type}`)}</Badge>
              <Badge tone={HANDLING_TONE[open.handling]}>{t(`social_moderation.handling.${open.handling}`)}</Badge>
              <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                {open.handled_at ? formatDateTime(open.handled_at) : ""}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words font-serif text-md text-[oklch(var(--color-ink))]">
              {item.data?.content ?? open.excerpt}
            </p>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 border-t border-[oklch(var(--color-block))] pt-3 text-sm">
              <dt className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("social_moderation.fields.reason")}</dt>
              <dd>{open.reason || <MissingValue kind="unrecorded" />}</dd>
              <dt className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("social_moderation.handled.col_by")}</dt>
              <dd>{open.handled_by?.display_name ?? <MissingValue kind="unrecorded" />}</dd>
            </dl>
            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("social_moderation.handled.read_only")}</p>
            <div className="border-t border-[oklch(var(--color-block))] pt-3">
              {open.handling === "HIDDEN" ? (
                <Button
                  type="button"
                  variant="primary"
                  loading={restore.isPending}
                  onClick={() =>
                    restore.mutate(
                      { row: open },
                      {
                        onSuccess: () => {
                          showToast(t("social_moderation.done"), "success");
                          setOpenId(null);
                        },
                        onError: fail,
                      }
                    )
                  }
                >
                  {t("social_moderation.handled.restore")}
                </Button>
              ) : (
                <p className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge tone="ink" glyph="■">{t("social_moderation.handled.in_recycle_bin")}</Badge>
                  <Link href="/recycle-bin" className="text-[oklch(var(--color-accent-ink))] underline">
                    {t("recycle_bin.manage_from_bin")} →
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
