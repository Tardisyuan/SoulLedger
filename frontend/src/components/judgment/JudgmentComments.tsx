"use client";

import { useId, useState } from "react";
import { JUDGMENT_COMMENT_MAX } from "@soulledger/core/api/judgment";
import { useAddJudgmentComment, useJudgmentComments } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { Collapse } from "@/src/components/ui/Collapse";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { TextAreaField } from "@/src/components/ui/Field";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * 评议: what the officers who can read this case have noted on it. Same words as the officer app
 * (`officer_app.comment.*`). A comment changes nothing about the case, so the form is there on open
 * and concluded cases alike; `canWrite` is the caller's `judgment.read` check (the server's
 * codename for both GET and POST), and without it there is no form at all.
 */
export const COMMENTS_SHOWN = 3;

export function JudgmentComments({ id, canWrite, concludedAt }: { id: string; canWrite: boolean; concludedAt?: string | null }) {
  const { t, formatDateTime } = useI18n();
  const regionId = useId();
  // null = not chosen yet: open when there are comments, closed when there are none.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [body, setBody] = useState("");
  const { data, isLoading, isError, refetch } = useJudgmentComments(id);
  const add = useAddJudgmentComment(id);
  const text = body.trim();
  const open = chosen ?? (data ? data.length > 0 : false);
  const all = data ?? [];
  const shown = showAll ? all : all.slice(-COMMENTS_SHOWN);
  const hidden = all.length - shown.length;
  // The first comment written after the case was concluded (ISO strings compare as text), if any.
  const firstAfter = concludedAt ? all.find((c) => c.created_at > concludedAt)?.id : undefined;

  const send = () => {
    if (text === "" || add.isPending) return;
    add.mutate(text, { onSuccess: () => setBody("") });
  };

  return (
    <section data-testid="judgment-comments" className="min-w-0 border-t border-[oklch(var(--color-line))] pt-3 md:col-span-2 xl:col-span-3 order-last">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setChosen(!open)}
        className="text-sm font-semibold text-[oklch(var(--color-ink))]"
      >
        {t("officer_app.comment.title")}
        {data ? ` · ${data.length}` : ""}
      </button>
      <Collapse open={open} id={regionId}>
        <div className="mt-3 flex flex-col gap-4">
          {isLoading ? (
            <PageSpinner />
          ) : isError ? (
            <QueryError onRetry={() => void refetch()} />
          ) : data && data.length === 0 ? (
            <EmptyState title={t("officer_app.comment.empty")} />
          ) : (
            <ul className="flex flex-col gap-3">
              {hidden > 0 && (
                <li>
                  <button type="button" data-testid="comments-show-rest" onClick={() => setShowAll(true)} className="text-sm text-[oklch(var(--color-ink-muted))] underline underline-offset-2">
                    {t("officer_app.comment.show_rest", { n: String(hidden) })}
                  </button>
                </li>
              )}
              {shown.map((c) => (
                <li key={c.id} data-testid={`comment-${c.id}`}>
                  {c.id === firstAfter && (
                    <div data-testid="comments-after-close" className="mb-3 flex items-center gap-3 text-sm text-[oklch(var(--color-ink-muted))]">
                      <span aria-hidden className="h-px flex-1 bg-[oklch(var(--color-line))]" />
                      <span>{t("officer_app.comment.after_close")}</span>
                      <span aria-hidden className="h-px flex-1 bg-[oklch(var(--color-line))]" />
                    </div>
                  )}
                  <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
                    {c.author_name || <MissingValue kind="unrecorded" />} · {formatDateTime(c.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-[oklch(var(--color-ink))]">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <TextAreaField
                label={t("officer_app.comment.write")}
                data-testid="comment-input"
                maxLength={JUDGMENT_COMMENT_MAX}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                error={add.isError ? t("officer_app.comment.failed") : null}
              />
              <div>
                <Button type="submit" variant="secondary" size="sm" loading={add.isPending} disabled={text === ""}>
                  {t("officer_app.comment.send")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Collapse>
    </section>
  );
}
