"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { InboxConversation } from "@soulledger/core/api/soul-inbox";
import { soulInboxKeys } from "@soulledger/core/query_keys";
import { useInboxConversations, useInboxMessages, useInboxReply } from "@soulledger/core/hooks/useSoulInbox";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { TextAreaField } from "@/src/components/ui/Field";
import { ListSkeleton } from "@/components/ui/skeleton";

/*
 * 殿司收件箱:灵魂写给**当前所在**殿司的信(backend/apps/chat/views.py `OfficerInboxViewSet`)。
 * 读要 `soul_inbox.read`(整页),回复另要 `soul_inbox.reply`(没有就不给回复框)。
 * 回复以殿司名义发出,事件里带上回复人;正文在 Synapse,不在我们的库里,也不进审计。
 * 已关闭的会话(灵魂已转世)只读。
 *
 * 只显示第一页(20 封)。ponytail: 按最近来信排,官员从头处理;积压超过一页再加翻页。
 */

const PANEL = "border border-[oklch(var(--color-hairline))] bg-[oklch(var(--color-surface-1))]";
const MUTED_TEXT = "text-xs text-[oklch(var(--color-ink-subtle))]";

/** 殿司展示名,按界面语言(`hall_names`,backend `Tenant.hall_names`);没有就退回租户名。 */
function hallOf(c: InboxConversation, locale: string): string {
  return c.hall_names?.[locale] || c.tenant_name;
}

function errorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

function Thread({ conversation }: { conversation: InboxConversation }) {
  const { t, formatDateTime, locale } = useI18n();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const messages = useInboxMessages(conversation.id);
  const reply = useInboxReply();
  const [body, setBody] = useState("");
  const canReply = hasPermission("soul_inbox.reply") && !conversation.closed_at;
  // 接口新的在前;读信从旧到新。
  const rows = [...(messages.data ?? [])].reverse();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    reply.mutate(
      { id: conversation.id, body },
      {
        onSuccess: () => {
          setBody("");
          showToast(t("soul_inbox.sent"), "success");
        },
        onError: (error) => {
          const code = errorCode(error);
          showToast(code ? t(`soul_inbox.errors.${code}`) : t("soul_inbox.failed"), "error");
        },
      }
    );
  };

  return (
    <section aria-label={t("soul_inbox.thread_label", { name: conversation.soul_name })} className={`${PANEL} p-4 space-y-4`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{conversation.soul_name}</span>
        <span className={`${MUTED_TEXT} font-mono`}>{conversation.soul_code}</span>
        {conversation.closed_at && <Badge tone="neutral">{t("soul_inbox.closed")}</Badge>}
      </header>
      {messages.isLoading ? (
        <ListSkeleton count={2} />
      ) : messages.isError ? (
        <QueryError onRetry={() => messages.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("soul_inbox.thread_empty")} />
      ) : (
        <ol className="space-y-3">
          {rows.map((m) => (
            <li key={m.event_id} data-event-id={m.event_id}
              className={m.from_officer ? "pl-6 border-l-2 border-[oklch(var(--color-hairline))]" : ""}>
              <p className={MUTED_TEXT}>
                {m.from_officer
                  ? t("soul_inbox.from_hall", { hall: hallOf(conversation, locale), title: m.officer_title, name: m.sender_name })
                      .replace(/\s+/g, " ")
                      .trim()
                  : m.sender_name}
                {" · "}
                {formatDateTime(new Date(m.timestamp).toISOString())}
              </p>
              <p className="text-sm text-[oklch(var(--color-ink))] whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      {canReply && (
        <form onSubmit={submit} className="space-y-2">
          <TextAreaField
            label={t("soul_inbox.reply_label")}
            description={t("soul_inbox.reply_hint")}
            maxLength={4000}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
            {t("soul_inbox.send")}
          </Button>
        </form>
      )}
    </section>
  );
}

function SoulInboxContent() {
  const { t, formatDateTime, locale } = useI18n();
  const queryClient = useQueryClient();
  const list = useInboxConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = list.data?.results ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <PageShell
      variant="page"
      title={t("soul_inbox.title")}
      subtitle={t("soul_inbox.subtitle")}
      actions={
        <Button type="button" variant="secondary" size="sm"
          onClick={() => void queryClient.invalidateQueries({ queryKey: soulInboxKeys.all })}>
          <RefreshCw aria-hidden="true" className="w-4 h-4 mr-1 inline" />
          {t("soul_inbox.refresh")}
        </Button>
      }
    >
      {list.isLoading ? (
        <ListSkeleton count={3} />
      ) : list.isError && !list.data ? (
        <QueryError onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("soul_inbox.empty")} reason={t("soul_inbox.empty_reason")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ul aria-label={t("soul_inbox.list_label")} className={PANEL}>
            {rows.map((r) => (
              <li key={r.id} className="border-b border-[oklch(var(--color-hairline))] last:border-b-0">
                <button type="button" data-conversation-id={r.id} aria-pressed={r.id === selectedId}
                  onClick={() => setSelectedId(r.id)}
                  className="w-full text-left p-4 space-y-1 hover:bg-[oklch(var(--color-surface-2))] aria-pressed:bg-[oklch(var(--color-surface-2))]">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.soul_name}</span>
                    {r.closed_at && <Badge tone="neutral">{t("soul_inbox.closed")}</Badge>}
                  </span>
                  <span className={`block ${MUTED_TEXT}`}>
                    {hallOf(r, locale)}
                    {" · "}
                    {r.last_message_at ? formatDateTime(r.last_message_at) : t("soul_inbox.no_messages")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <Thread key={selected.id} conversation={selected} />
          ) : (
            <EmptyState title={t("soul_inbox.select_hint")} />
          )}
        </div>
      )}
    </PageShell>
  );
}

export default function SoulInboxPage() {
  return (
    <RequirePermission permissions="soul_inbox.read" fallback={<PermissionDenied />}>
      <SoulInboxContent />
    </RequirePermission>
  );
}
