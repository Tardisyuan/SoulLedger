"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ContentKind,
  ModeratedComment,
  ModeratedPost,
  ModerationReport,
} from "@soulledger/core/api/social-moderation";
import {
  useModeratedContent,
  useModeratedItem,
  useModerateContent,
  useModerationReports,
  useResolveReport,
} from "@soulledger/core/hooks/useSocialModeration";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { fieldControl } from "@/src/components/ui/Field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MediaGrid } from "./MediaGrid";
import { MODERATION_TONES, isTyping, useFailureToast } from "./shared";

/**
 * 举报区 = C 组 08「朋友圈审阅」的版式:左列表、右详情。
 *
 * ONE QUEUE, TWO SOURCES. The canvas's list holds both what souls reported and
 * what the word list held back (「规则命中」), because to the officer they are
 * the same job — look, then let it through or hide it. So the list is the open
 * reports plus the PENDING posts and comments. A pending item that is ALSO
 * reported is one row, not two: the report carries it, and 放行 both dismisses
 * the report and approves the content, or it would come straight back as a
 * rule hit.
 *
 * A / H are the canvas's keys; W (警告作者) is not here because the API has no
 * warn resolution (`SocialReportResolutionEnum` is HIDE / DELETE / MUTE /
 * DISMISS). 删除 and 禁言 are not on the canvas but are what the queue could
 * already do, so they stay as the quieter second row.
 */

type PendingRow = ModeratedPost | ModeratedComment;

/** `sensitive_word:<词>` → 词 (backend/apps/social/moderation.py::AUTO_REASON_PREFIX); anything else → null. */
const SENSITIVE_WORD_PREFIX = "sensitive_word:";
function heldForWord(row: PendingRow): string | null {
  const reason = row.moderation_reason ?? "";
  return reason.startsWith(SENSITIVE_WORD_PREFIX) ? reason.slice(SENSITIVE_WORD_PREFIX.length) : null;
}

interface ReviewItem {
  key: string;
  report: ModerationReport | null;
  /** The PENDING row this item carries, when the word list held it back. */
  pending: { kind: ContentKind; row: PendingRow } | null;
  /** The content the item is about, for the full-text fetch. Null: a report on a user. */
  target: { kind: ContentKind; id: string } | null;
  author: string;
  time: string;
  excerpt: string;
  /** Images on the post (C-08's 「图 N」); null for a comment or a user. */
  mediaCount: number | null;
}

const MUTE_DAYS = [1, 3, 7, 30, 90, 365];

function buildItems(reports: ModerationReport[], posts: PendingRow[], comments: PendingRow[]): ReviewItem[] {
  const pendingById = new Map<string, { kind: ContentKind; row: PendingRow }>();
  posts.forEach((row) => pendingById.set(row.id, { kind: "posts", row }));
  comments.forEach((row) => pendingById.set(row.id, { kind: "comments", row }));

  const items: ReviewItem[] = reports.map((r) => {
    const target = r.post ? { kind: "posts" as const, id: r.post } : r.comment ? { kind: "comments" as const, id: r.comment } : null;
    const pending = target ? pendingById.get(target.id) ?? null : null;
    if (target) pendingById.delete(target.id);
    return {
      key: `report:${r.id}`,
      report: r,
      pending,
      target,
      author: r.target_user?.display_name ?? "",
      time: r.last_reported_at,
      excerpt: r.content_excerpt,
      mediaCount: r.target_type === "POST" ? r.media_count : null,
    };
  });
  for (const [id, p] of pendingById) {
    items.push({
      key: `${p.kind}:${id}`,
      report: null,
      pending: p,
      target: { kind: p.kind, id },
      author: p.row.author?.display_name ?? "",
      time: p.row.create_time,
      excerpt: p.row.content,
      mediaCount: "media_count" in p.row ? p.row.media_count : null,
    });
  }
  return items.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 flex-none items-center justify-center bg-[oklch(var(--color-surface-3))] text-sm font-medium text-[oklch(var(--color-ink))]"
    >
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}

export function ReportsReview() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  /** 「因敏感词「…」待审」 when the word list says which word; the generic label otherwise. */
  const ruleHit = (row: PendingRow) => {
    const word = heldForWord(row);
    return word ? t("social_moderation.review.held_for_word", { word }) : t("social_moderation.review.rule_hit");
  };
  const reports = useModerationReports({});
  const posts = useModeratedContent("posts", {});
  const comments = useModeratedContent("comments", {});
  const resolve = useResolveReport();
  const moderate = useModerateContent();

  const items = useMemo(
    () =>
      buildItems(
        reports.data?.results ?? [],
        (posts.data?.results ?? []) as PendingRow[],
        (comments.data?.results ?? []) as PendingRow[]
      ),
    [reports.data, posts.data, comments.data]
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [muteDays, setMuteDays] = useState(7);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  // A handled item leaves the queue; the selection then falls to the first
  // item rather than to nothing, so the next one is already on screen.
  const index = Math.max(0, items.findIndex((i) => i.key === selectedKey));
  const selected = items[index] ?? null;

  const select = (key: string) => {
    setSelectedKey(key);
    setReason("");
    setReasonError(false);
  };

  const item = useModeratedItem(selected?.target?.kind ?? "posts", selected?.target && !selected.pending ? selected.target.id : null);
  const full = selected?.pending?.row ?? item.data ?? null;

  const run = async (steps: (() => Promise<unknown>)[]) => {
    setBusy(true);
    try {
      for (const step of steps) await step();
      showToast(t("social_moderation.done"), "success");
      setReason("");
      setReasonError(false);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  };

  const approve = () => {
    if (!selected || busy) return;
    const note = reason.trim() || undefined;
    const steps: (() => Promise<unknown>)[] = [];
    if (selected.report) steps.push(() => resolve.mutateAsync({ id: selected.report!.id, resolution: "DISMISS", note }));
    if (selected.pending) {
      const { kind, row } = selected.pending;
      steps.push(() => moderate.mutateAsync({ kind, id: row.id, action: "approve", reason: note }));
    }
    void run(steps);
  };

  const canHide = Boolean(selected?.target);
  const hide = () => {
    if (!selected || busy || !canHide) return;
    const note = reason.trim();
    if (!note) {
      setReasonError(true);
      document.getElementById("review-reason")?.focus();
      return;
    }
    if (selected.report) {
      void run([() => resolve.mutateAsync({ id: selected.report!.id, resolution: "HIDE", note })]);
    } else if (selected.pending) {
      const { kind, row } = selected.pending;
      void run([() => moderate.mutateAsync({ kind, id: row.id, action: "hide", reason: note })]);
    }
  };

  const remove = () => {
    if (!selected) return;
    const note = reason.trim() || undefined;
    if (selected.report) void run([() => resolve.mutateAsync({ id: selected.report!.id, resolution: "DELETE", note })]);
    else if (selected.pending) {
      const { kind, row } = selected.pending;
      void run([() => moderate.mutateAsync({ kind, id: row.id, action: "delete", reason: note })]);
    }
  };

  const mute = () => {
    if (!selected?.report || busy) return;
    void run([
      () => resolve.mutateAsync({ id: selected.report!.id, resolution: "MUTE", note: reason.trim() || undefined, muteDays }),
    ]);
  };

  // J / K / A / H — ignored while typing, with a modifier, or under a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || deleting) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        const next = items[index + (key === "j" ? 1 : -1)];
        if (next) {
          e.preventDefault();
          select(next.key);
        }
      } else if (key === "a") {
        e.preventDefault();
        approve();
      } else if (key === "h") {
        e.preventDefault();
        hide();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const loading = reports.isLoading || posts.isLoading || comments.isLoading;
  const failed = (reports.isError && !reports.data) || (posts.isError && !posts.data) || (comments.isError && !comments.data);

  if (loading) return <ListSkeleton count={3} />;
  if (failed)
    return (
      <QueryError
        onRetry={() => {
          void reports.refetch();
          void posts.refetch();
          void comments.refetch();
        }}
      />
    );
  if (items.length === 0)
    return <EmptyState title={t("social_moderation.empty.review")} reason={t("social_moderation.empty.review_reason")} />;

  return (
    <div className="grid grid-cols-1 border-t border-[oklch(var(--color-block))] md:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <ul aria-label={t("social_moderation.review.list_label")} className="md:border-r border-[oklch(var(--color-rule))]">
        {items.map((it) => {
          const on = it.key === selected?.key;
          const reportCount = it.report?.report_count ?? 0;
          return (
            <li key={it.key} data-review-key={it.key} className="border-b border-[oklch(var(--color-rule))]">
              <button
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => select(it.key)}
                className={cn(
                  "flex w-full gap-3 px-4 py-3 text-left hover:bg-[oklch(var(--color-surface-2))]",
                  on && "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-ink))]"
                )}
              >
                <Initial name={it.author} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <b className="font-medium text-[oklch(var(--color-ink))]">{it.author}</b>
                    <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{formatDateTime(it.time)}</span>
                  </span>
                  <span title={it.excerpt} className="mt-1 block truncate font-serif text-sm text-[oklch(var(--color-ink))]">{it.excerpt}</span>
                  <span className="mt-1 flex flex-wrap gap-3 font-mono text-2xs">
                    {it.mediaCount !== null && (
                      <span data-media-count className="text-[oklch(var(--color-ink-subtle))]">
                        {t("social_moderation.review.media_n", { n: String(it.mediaCount) })}
                      </span>
                    )}
                    <span className={reportCount > 0 ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink-subtle))]"}>
                      {t("social_moderation.review.report_n", { n: String(reportCount) })}
                    </span>
                    {it.pending && (
                      <span className="text-[oklch(var(--color-warning))]">{ruleHit(it.pending.row)}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <section aria-label={t("social_moderation.review.detail_label")} data-review-detail={selected.key} className="min-w-0 px-4 py-4 md:px-6">
          <div className="flex items-start gap-3">
            <Initial name={selected.author} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[oklch(var(--color-ink))]">{selected.author}</div>
              <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                {selected.report ? <DomainEnum namespace="social_moderation.target_type" value={selected.report.target_type} /> : t(`social_moderation.kind.${selected.pending!.kind}`)}
                {" · "}
                {formatDateTime(full?.create_time ?? selected.time)}
              </div>
            </div>
            {(full?.moderation_status || selected.report?.content_status) && (
              <StatusBadge
                namespace="social_moderation.moderation_status"
                value={full?.moderation_status ?? selected.report?.content_status}
                tone={MODERATION_TONES[full?.moderation_status ?? selected.report?.content_status ?? ""] ?? "neutral"}
              />
            )}
          </div>

          {selected.target ? (
            <p className="mt-4 max-w-[72ch] whitespace-pre-wrap break-words font-serif text-md text-[oklch(var(--color-ink))]">
              {full?.content ?? selected.excerpt}
            </p>
          ) : (
            <p className="mt-4 text-sm text-[oklch(var(--color-ink-muted))]">{t("social_moderation.review.user_target_note")}</p>
          )}
          {full && "media" in full && <MediaGrid media={full.media} />}

          {/* 反应用文字,不用表情(C-08)。只画接口给了的数:官员端的帖子序列化器只带评论数。 */}
          {full && "comment_count" in full && (
            <div className="mt-3 flex gap-4 text-xs text-[oklch(var(--color-ink-muted))]">
              <span>
                {t("social_moderation.review.reaction_comment")} <span className="font-mono">{full.comment_count}</span>
              </span>
            </div>
          )}

          {selected.report && (
            <>
              <h3 className="mt-6 border-b border-[oklch(var(--color-block))] pb-1 font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
                {t("social_moderation.review.report_n", { n: String(selected.report.report_count) })}
              </h3>
              <ul>
                {selected.report.entries.map((e, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 border-b border-[oklch(var(--color-rule))] py-2 text-sm">
                    <span className="min-w-0">
                      <DomainEnum namespace="social_moderation.reason" value={e.reason} />
                      {e.detail && <span className="text-[oklch(var(--color-ink-muted))]"> — {e.detail}</span>}
                      {e.reporter && (
                        <span className="text-[oklch(var(--color-ink-subtle))]">
                          {" · "}
                          {t("social_moderation.review.from", { name: e.reporter.display_name })}
                        </span>
                      )}
                    </span>
                    <span className="flex-none font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{formatDateTime(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {selected.pending && (
            <p className="mt-3 flex items-center gap-2 text-sm">
              <Badge tone="warning" glyph="◇">{ruleHit(selected.pending.row)}</Badge>
            </p>
          )}

          <div className="mt-6 border-t border-[oklch(var(--color-block))] pt-3">
            <label htmlFor="review-reason" className="block text-xs text-[oklch(var(--color-ink-muted))]">
              {t("social_moderation.review.reason_label")}
            </label>
            <textarea
              id="review-reason"
              rows={2}
              value={reason}
              aria-invalid={reasonError || undefined}
              aria-describedby={reasonError ? "review-reason-error" : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.trim()) setReasonError(false);
              }}
              className={cn(fieldControl({ size: "md", invalid: reasonError }), "mt-1 h-auto w-full py-2")}
            />
            {reasonError && (
              <p id="review-reason-error" role="alert" className="mt-1 text-xs text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {t("social_moderation.review.reason_required")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" size="sm" onClick={approve} disabled={busy} aria-keyshortcuts="A">
                {t("social_moderation.review.approve")}
                <kbd className="ml-2 font-mono text-2xs opacity-70">A</kbd>
              </Button>
              {canHide && (
                <Button type="button" variant="warning" size="sm" onClick={hide} disabled={busy} aria-keyshortcuts="H">
                  {t("social_moderation.actions.hide")}
                  <kbd className="ml-2 font-mono text-2xs opacity-70">H</kbd>
                </Button>
              )}
              <span className="flex-1" />
              {canHide && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(true)} disabled={busy}>
                  {t("social_moderation.actions.delete")}
                </Button>
              )}
              {selected.report && (
                <span className="flex items-center gap-1">
                  <select
                    aria-label={t("social_moderation.mute_days")}
                    value={String(muteDays)}
                    onChange={(e) => setMuteDays(Number(e.target.value))}
                    className={cn(fieldControl({ size: "sm" }), "w-auto")}
                  >
                    {MUTE_DAYS.map((n) => (
                      <option key={n} value={n}>
                        {t("social_moderation.mute_days_option", { n: String(n) })}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="sm" onClick={mute} disabled={busy}>
                    {t("social_moderation.actions.mute")}
                  </Button>
                </span>
              )}
            </div>
            <p className="mt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("social_moderation.review.shortcuts")}</p>
          </div>
        </section>
      )}

      <ConfirmDialog
        isOpen={deleting}
        title={t("social_moderation.confirm_delete_title")}
        message={t("social_moderation.confirm_delete_body")}
        confirmText={t("social_moderation.actions.delete")}
        confirmLoading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}
