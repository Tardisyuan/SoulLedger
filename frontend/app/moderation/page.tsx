"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  type ContentKind,
  type ModeratedComment,
  type ModeratedPost,
  type ModerationReport,
  type ReportResolution,
} from "@soulledger/core/api/social-moderation";
import { socialModerationKeys } from "@soulledger/core/query_keys";
import {
  moderationErrorCode,
  useAddSensitiveWord,
  useLiftMute,
  useModerateContent,
  useModeratedContent,
  useModerationReports,
  useRemoveSensitiveWord,
  useResolveReport,
  useSensitiveWords,
  useSocialMutes,
} from "@soulledger/core/hooks/useSocialModeration";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

/*
 * 官员审核后台:/api/v1/social-moderation/ 的四个分区。每个端点都要 `social.moderate`
 * (backend/apps/social/moderation_views.py),页面整体包在同一个码名里 —— 没有
 * 「只能看不能处置」的状态,所以没有 canManage 分支。
 *
 * 只显示第一页(20 条)。ponytail: 队列按时间排,官员从头处理;积压超过一页再加翻页。
 */

type Tab = "reports" | "content" | "words" | "mutes";
const TABS: Tab[] = ["reports", "content", "words", "mutes"];
const MUTE_DAYS = [1, 3, 7, 30];
const ROW = "p-4 space-y-2 border-b border-[oklch(var(--color-hairline))] last:border-b-0";
const MUTED_TEXT = "text-02 text-[oklch(var(--color-ink-subtle))]";

function useFailureToast() {
  const { t } = useI18n();
  const { showToast } = useToast();
  return (error: unknown) => {
    const code = moderationErrorCode(error);
    showToast(code ? t(`social_moderation.errors.${code}`) : t("social_moderation.failed"), "error");
  };
}

function Section({ loading, failed, onRetry, empty, children }: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  empty: React.ReactNode | null;
  children: React.ReactNode;
}) {
  if (loading) return <ListSkeleton count={3} />;
  if (failed) return <QueryError onRetry={onRetry} />;
  if (empty) return <>{empty}</>;
  return <ul className="border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))]">{children}</ul>;
}

function ReportsTab() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const list = useModerationReports({});
  const resolve = useResolveReport();
  const [muteDays, setMuteDays] = useState(7);
  const [deleting, setDeleting] = useState<ModerationReport | null>(null);
  const rows = list.data?.results ?? [];

  const act = (report: ModerationReport, resolution: ReportResolution) =>
    resolve.mutate(
      { id: report.id, resolution, muteDays: resolution === "MUTE" ? muteDays : undefined },
      { onSuccess: () => showToast(t("social_moderation.done"), "success"), onError: fail, onSettled: () => setDeleting(null) }
    );

  return (
    <div className="space-y-4">
      <SelectField
        label={t("social_moderation.mute_days")}
        size="sm"
        className="max-w-xs"
        value={String(muteDays)}
        onChange={(e) => setMuteDays(Number(e.target.value))}
        options={MUTE_DAYS.map((n) => ({ value: String(n), label: t("social_moderation.mute_days_option", { n: String(n) }) }))}
      />
      <Section
        loading={list.isLoading}
        failed={list.isError && !list.data}
        onRetry={() => list.refetch()}
        empty={rows.length === 0 ? <EmptyState title={t("social_moderation.empty.reports")} /> : null}
      >
        {rows.map((r) => {
          const busy = resolve.isPending && resolve.variables?.id === r.id;
          const isContent = r.target_type !== "USER";
          return (
            <li key={r.id} data-report-id={r.id} className={ROW}>
              <div className="flex flex-wrap items-center gap-2">
                <DomainEnum namespace="social_moderation.target_type" value={r.target_type} />
                <Badge tone="warning">{t("social_moderation.report_count", { n: String(r.report_count) })}</Badge>
                {r.content_status && <DomainEnum namespace="social_moderation.moderation_status" value={r.content_status} />}
                <span className={MUTED_TEXT}>{formatDateTime(r.last_reported_at)}</span>
              </div>
              <p className="text-03 text-[oklch(var(--color-ink))] break-words">
                {r.target_user?.display_name}
                {r.content_excerpt && <span className="text-[oklch(var(--color-ink-muted))]">:{r.content_excerpt}</span>}
              </p>
              <ul className={MUTED_TEXT}>
                {r.entries.map((e, i) => (
                  <li key={i}>
                    <DomainEnum namespace="social_moderation.reason" value={e.reason} />
                    {e.detail && ` — ${e.detail}`}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {isContent && (
                  <Button type="button" size="sm" variant="warning" disabled={busy} onClick={() => act(r, "HIDE")}>
                    {t("social_moderation.actions.hide")}
                  </Button>
                )}
                {isContent && (
                  <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(r)}>
                    {t("social_moderation.actions.delete")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act(r, "MUTE")}>
                  {t("social_moderation.actions.mute")} · {t("social_moderation.mute_days_option", { n: String(muteDays) })}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act(r, "DISMISS")}>
                  {t("social_moderation.actions.dismiss")}
                </Button>
              </div>
            </li>
          );
        })}
      </Section>
      <ConfirmDialog
        isOpen={deleting !== null}
        title={t("social_moderation.confirm_delete_title")}
        message={t("social_moderation.confirm_delete_body")}
        confirmText={t("social_moderation.actions.delete")}
        confirmLoading={resolve.isPending}
        onConfirm={() => deleting && act(deleting, "DELETE")}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function ContentTab() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const [kind, setKind] = useState<ContentKind>("posts");
  const [status, setStatus] = useState<"PENDING" | "HIDDEN">("PENDING");
  const list = useModeratedContent(kind, { moderation_status: status });
  const moderate = useModerateContent();
  const [deleting, setDeleting] = useState<string | null>(null);
  const rows: (ModeratedPost | ModeratedComment)[] = list.data?.results ?? [];

  const act = (id: string, action: "approve" | "hide" | "restore" | "delete") =>
    moderate.mutate(
      { kind, id, action },
      { onSuccess: () => showToast(t("social_moderation.done"), "success"), onError: fail, onSettled: () => setDeleting(null) }
    );

  const toggle = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <Button key={value} type="button" size="sm" variant={current === value ? "primary" : "secondary"}
      aria-pressed={current === value} onClick={() => set(value)}>
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["posts", "comments"] as const).map((k) => toggle(k, kind, setKind, t(`social_moderation.kind.${k}`)))}
        <span aria-hidden="true" className="w-4" />
        {(["PENDING", "HIDDEN"] as const).map((s) => toggle(s, status, setStatus, t(`social_moderation.status_filter.${s}`)))}
      </div>
      <Section
        loading={list.isLoading}
        failed={list.isError && !list.data}
        onRetry={() => list.refetch()}
        empty={rows.length === 0 ? (
          <EmptyState title={t("social_moderation.empty.content")} reason={t("social_moderation.empty.content_reason")} />
        ) : null}
      >
        {rows.map((row) => {
          const busy = moderate.isPending && moderate.variables?.id === row.id;
          return (
            <li key={row.id} data-content-id={row.id} className={ROW}>
              <div className="flex flex-wrap items-center gap-2">
                <DomainEnum namespace="social_moderation.moderation_status" value={row.moderation_status} />
                <span className="text-03 font-medium">{row.author?.display_name}</span>
                <span className={MUTED_TEXT}>{formatDateTime(row.create_time)}</span>
              </div>
              <p className="text-03 text-[oklch(var(--color-ink-muted))] whitespace-pre-wrap break-words">{row.content}</p>
              <div className="flex flex-wrap gap-2">
                {row.moderation_status === "PENDING" && (
                  <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => act(row.id, "approve")}>
                    {t("social_moderation.actions.approve")}
                  </Button>
                )}
                {row.moderation_status === "PENDING" && (
                  <Button type="button" size="sm" variant="warning" disabled={busy} onClick={() => act(row.id, "hide")}>
                    {t("social_moderation.actions.hide")}
                  </Button>
                )}
                {row.moderation_status === "HIDDEN" && (
                  <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act(row.id, "restore")}>
                    {t("social_moderation.actions.restore")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(row.id)}>
                  {t("social_moderation.actions.delete")}
                </Button>
              </div>
            </li>
          );
        })}
      </Section>
      <ConfirmDialog
        isOpen={deleting !== null}
        title={t("social_moderation.confirm_delete_title")}
        message={t("social_moderation.confirm_delete_body")}
        confirmText={t("social_moderation.actions.delete")}
        confirmLoading={moderate.isPending}
        onConfirm={() => deleting && act(deleting, "delete")}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function WordsTab() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const list = useSensitiveWords();
  const add = useAddSensitiveWord();
  const remove = useRemoveSensitiveWord();
  const [word, setWord] = useState("");
  const [removing, setRemoving] = useState<{ id: string; word: string } | null>(null);
  const rows = list.data?.results ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    add.mutate(word, {
      onSuccess: () => {
        setWord("");
        showToast(t("social_moderation.done"), "success");
      },
      onError: fail,
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <TextField
          label={t("social_moderation.fields.word")}
          description={t("social_moderation.word_hint")}
          className="min-w-0 flex-1"
          maxLength={50}
          value={word}
          placeholder={t("social_moderation.word_placeholder")}
          onChange={(e) => setWord(e.target.value)}
        />
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!word.trim()}>
          {t("social_moderation.actions.add_word")}
        </Button>
      </form>
      <Section
        loading={list.isLoading}
        failed={list.isError && !list.data}
        onRetry={() => list.refetch()}
        empty={rows.length === 0 ? <EmptyState title={t("social_moderation.empty.words")} /> : null}
      >
        {rows.map((w) => (
          <li key={w.id} className={`${ROW} flex items-center justify-between gap-4 space-y-0`}>
            <span className="font-mono text-03 break-all">{w.word}</span>
            <span className="flex items-center gap-3">
              <span className={MUTED_TEXT}>{formatDateTime(w.created_at)}</span>
              <Button type="button" size="sm" variant="danger" onClick={() => setRemoving({ id: w.id, word: w.word })}>
                {t("social_moderation.actions.remove_word")}
              </Button>
            </span>
          </li>
        ))}
      </Section>
      <ConfirmDialog
        isOpen={removing !== null}
        title={t("social_moderation.confirm_remove_word_title", { word: removing?.word ?? "" })}
        message={t("social_moderation.confirm_remove_word_body")}
        confirmText={t("social_moderation.actions.remove_word")}
        confirmLoading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => showToast(t("social_moderation.done"), "success"),
            onError: fail,
            onSettled: () => setRemoving(null),
          })
        }
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function MutesTab() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const list = useSocialMutes();
  const lift = useLiftMute();
  const rows = list.data?.results ?? [];

  return (
    <Section
      loading={list.isLoading}
      failed={list.isError && !list.data}
      onRetry={() => list.refetch()}
      empty={rows.length === 0 ? <EmptyState title={t("social_moderation.empty.mutes")} /> : null}
    >
      {rows.map((m) => (
        <li key={m.id} data-mute-id={m.id} className={`${ROW} flex flex-wrap items-center justify-between gap-4 space-y-0`}>
          <span className="min-w-0 space-y-1">
            <span className="block text-03 font-medium">{m.user?.display_name}</span>
            <span className={`block ${MUTED_TEXT}`}>
              {t("social_moderation.fields.until")} {formatDateTime(m.until)}
              {m.reason && ` · ${m.reason}`}
            </span>
          </span>
          {m.is_active ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={lift.isPending && lift.variables === m.id}
              onClick={() =>
                lift.mutate(m.id, { onSuccess: () => showToast(t("social_moderation.done"), "success"), onError: fail })
              }
            >
              {t("social_moderation.actions.lift")}
            </Button>
          ) : (
            <Badge tone="neutral">{t(m.lifted_at ? "social_moderation.mute_lifted" : "social_moderation.mute_expired")}</Badge>
          )}
        </li>
      ))}
    </Section>
  );
}

function ModerationPageContent() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("reports");

  return (
    <PageShell
      variant="page"
      title={t("social_moderation.title")}
      subtitle={t("social_moderation.subtitle")}
      actions={
        <Button type="button" variant="secondary" size="sm"
          onClick={() => void queryClient.invalidateQueries({ queryKey: socialModerationKeys.all })}>
          <RefreshCw aria-hidden="true" className="w-4 h-4 mr-1 inline" />
          {t("social_moderation.refresh")}
        </Button>
      }
      tabs={
        <div role="group" aria-label={t("social_moderation.tabs.label")} className="flex flex-wrap">
          {TABS.map((value) => (
            <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}
              className={`${TAB_BASE} ${tab === value ? TAB_ON : TAB_OFF}`}>
              {t(`social_moderation.tabs.${value}`)}
            </button>
          ))}
        </div>
      }
    >
      {tab === "reports" && <ReportsTab />}
      {tab === "content" && <ContentTab />}
      {tab === "words" && <WordsTab />}
      {tab === "mutes" && <MutesTab />}
    </PageShell>
  );
}

export default function ModerationPage() {
  return (
    <RequirePermission permissions="social.moderate" fallback={<PermissionDenied />}>
      <ModerationPageContent />
    </RequirePermission>
  );
}
