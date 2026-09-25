"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { judgmentApi, type Statute } from "@soulledger/core/api";
import type { InboxConversation, InboxMessage } from "@soulledger/core/api/soul-inbox";
import { judgmentKeys, soulInboxKeys } from "@soulledger/core/query_keys";
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
import { ListSkeleton } from "@/components/ui/skeleton";

/*
 * 殿司收件箱:灵魂写给**当前所在**殿司的信(backend/apps/chat/views.py `OfficerInboxViewSet`)。
 * 读要 `soul_inbox.read`(整页),回复另要 `soul_inbox.reply`(没有就不给回复框)。
 * 回复以殿司名义发出,事件里带上回复人;正文在 Synapse,不在我们的库里,也不进审计。
 * 已关闭的会话(灵魂已转世)只读。
 *
 * 版式是设计稿 C · 09 的三栏:文件夹 · 信件列表 · 线程;< 1024 px 时文件夹收成列表头的
 * 下拉,线程排在列表下方。
 *
 * 文件夹只有接口答得出的那几个:全部、往来中 / 已关闭(`closed_at`)、按殿(`hall_names`)。
 * 设计稿里的「待回复 / 已回复 / 草稿 / 归档」与未读标都要列表接口没有的字段 —— 谁最后说话、
 * 草稿、归档、已读 —— 所以不画,而不是拿别的东西冒充。「待回复 · N 天」只在打开的线程上
 * 算:那时消息已经在手,最后一封是灵魂写的就是待回复。
 *
 * 只显示第一页(20 封)。ponytail: 按最近来信排,官员从头处理;积压超过一页再加翻页。
 * 派生文件夹的计数只在第一页就是全部时才写 —— 否则那是「这一页里有几封」,读起来却像总数。
 */

const RULE = "border-[oklch(var(--color-rule))]";
const LINE = "border-[oklch(var(--color-line))]";
const MUTED_TEXT = "text-xs text-[oklch(var(--color-ink-subtle))]";
const SECTION_HEAD = "font-mono text-2xs tracking-wide text-[oklch(var(--color-ink-subtle))]";
const CURRENT = "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-ink))] text-[oklch(var(--color-ink))] font-medium";

type Folder = "all" | "open" | "closed" | `hall:${number}`;

/** 殿司展示名,按界面语言(`hall_names`,backend `Tenant.hall_names`);没有就退回租户名。 */
function hallOf(c: InboxConversation, locale: string): string {
  return c.hall_names?.[locale] || c.tenant_name;
}

function errorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

function inFolder(c: InboxConversation, folder: Folder): boolean {
  if (folder === "all") return true;
  if (folder === "open") return !c.closed_at;
  if (folder === "closed") return !!c.closed_at;
  return `hall:${c.tenant}` === folder;
}

/**
 * 回复框 = 审判台的衬线输入框(QuoteInput,`app/judgment/[id]/page.tsx`),加一条:
 * 在行首或空白后打 `/` 开始检索律条,回车把「〔编号 · 标题〕」写进正文。
 *
 * 写进的是**文字**:回复正文是纯文本,存在 Synapse,灵魂看到的就是这几个字 —— 没有
 * 结构化的援引可存(那是审判的 `JudgmentCitation`,不是信)。检索走律条接口,要
 * `judgment.read`;没有这条权限,`/` 就只是一个字符,提示也不显示。
 */
function Composer({
  label,
  hint,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const { hasPermission } = usePermissions();
  const canCite = hasPermission("judgment.read");
  const id = useId();
  const listId = `${id}-statutes`;
  const ref = useRef<HTMLTextAreaElement>(null);
  // 触发点:`/` 在正文里的下标。null = 没在检索;按 Esc 关掉的那个 `/` 记在 dismissed 里。
  const [slashAt, setSlashAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const query = slashAt === null ? "" : value.slice(slashAt + 1, caret);

  const search = useQuery({
    queryKey: [...judgmentKeys.all, "statute-search", "", query],
    queryFn: () => judgmentApi.statutes({ search: query }).then((r) => r.data.results ?? []),
    enabled: canCite && slashAt !== null && query.length > 0,
    staleTime: 60_000,
  });
  const results: Statute[] = (slashAt !== null && query ? search.data : undefined)?.slice(0, 6) ?? [];
  const open = slashAt !== null && query.length > 0;

  const track = (text: string, at: number) => {
    setCaret(at);
    if (!canCite) return;
    const before = text.slice(0, at);
    const i = before.lastIndexOf("/");
    const token = i >= 0 ? before.slice(i + 1) : "";
    const starts = i >= 0 && (i === 0 || /\s/.test(before[i - 1]));
    if (starts && !/\s/.test(token) && token.length <= 30 && i !== dismissed) {
      if (i !== slashAt) setActive(0);
      setSlashAt(i);
    } else {
      setSlashAt(null);
    }
  };

  const insert = (s: Statute) => {
    if (slashAt === null) return;
    const cite = `〔${s.code}${s.display_title ? ` · ${s.display_title}` : ""}〕`;
    const next = value.slice(0, slashAt) + cite + value.slice(caret);
    const at = slashAt + cite.length;
    onChange(next);
    setSlashAt(null);
    setCaret(at);
    requestAnimationFrame(() => ref.current?.setSelectionRange(at, at));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(slashAt);
      setSlashAt(null);
    } else if (results.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (results.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      insert(results[Math.min(active, results.length - 1)]);
    }
  };

  return (
    <div className="mt-4 border border-[oklch(var(--color-block))] bg-[oklch(var(--color-surface-1))]">
      <div className={`flex flex-wrap items-center gap-3 px-3 py-1.5 border-b ${LINE} text-xs text-[oklch(var(--color-ink-muted))]`}>
        <label htmlFor={id} className="font-medium text-[oklch(var(--color-ink))]">
          {label}
        </label>
        {canCite && <span className="font-mono text-[oklch(var(--color-ink-subtle))]">{t("soul_inbox.cite_hint")}</span>}
      </div>
      <div className="relative">
        <textarea
          id={id}
          ref={ref}
          maxLength={4000}
          rows={3}
          value={value}
          aria-describedby={`${id}-hint`}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && results.length > 0 ? `${listId}-${Math.min(active, results.length - 1)}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            track(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setSlashAt(null)}
          className="block w-full min-h-[84px] px-3 py-2 bg-transparent font-serif text-quote text-[oklch(var(--color-ink))] placeholder:text-[oklch(var(--color-ink-subtle))] resize-y"
        />
        {open && (
          <div className={`absolute left-3 right-3 top-full z-10 border ${LINE} bg-[oklch(var(--color-canvas))] shadow-overlay`}>
            <p role="status" className="sr-only">
              {results.length > 0 ? t("soul_inbox.cite_results", { n: String(results.length) }) : ""}
            </p>
            {results.length === 0 ? (
              <p className={`px-3 py-2 ${MUTED_TEXT}`}>{search.isFetching ? "…" : t("soul_inbox.cite_empty")}</p>
            ) : (
              <div id={listId} role="listbox" aria-label={t("soul_inbox.cite_label")}>
                {results.map((s, i) => (
                  <div
                    key={s.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    // mousedown, not click: click lands after the textarea's blur has closed the list.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(s);
                    }}
                    className={`px-3 py-1.5 border-b ${RULE} cursor-pointer aria-selected:bg-[oklch(var(--color-surface-2))]`}
                  >
                    <span className="font-mono text-xs">{s.code}</span>
                    {s.display_title && <span className="ml-2 text-sm">{s.display_title}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <p id={`${id}-hint`} className={`px-3 py-2 border-t ${LINE} ${MUTED_TEXT}`}>
        {hint}
      </p>
    </div>
  );
}

/** One letter. The newest is read at quote size; earlier ones step down and hang off a 2 px structure line. */
function Letter({ m, conversation, latest, previous }: { m: InboxMessage; conversation: InboxConversation; latest: boolean; previous: boolean }) {
  const { t, formatDateTime, locale } = useI18n();
  const who = m.from_officer
    ? `${t("soul_inbox.officer_reply")} · ${t("soul_inbox.from_hall", { hall: hallOf(conversation, locale), title: m.officer_title, name: m.sender_name })
        .replace(/\s+/g, " ")
        .trim()}`
    : t("soul_inbox.from_soul", { name: m.sender_name });
  return (
    <li
      data-event-id={m.event_id}
      className={`py-4 border-b ${RULE} ${latest ? "" : "pl-4 shadow-[inset_2px_0_0_oklch(var(--color-line))]"}`}
    >
      <p className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        {who}
        {" · "}
        {formatDateTime(new Date(m.timestamp).toISOString())}
        {previous && ` · ${t("soul_inbox.previous")}`}
      </p>
      <p
        className={`mt-2 max-w-[60ch] font-serif whitespace-pre-wrap break-words ${
          latest ? "text-quote text-[oklch(var(--color-ink))]" : "text-md font-normal text-[oklch(var(--color-ink-muted))]"
        }`}
      >
        {m.body}
      </p>
    </li>
  );
}

function Thread({ conversation }: { conversation: InboxConversation }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const messages = useInboxMessages(conversation.id);
  const reply = useInboxReply();
  const [body, setBody] = useState("");
  const [showEarlier, setShowEarlier] = useState(false);
  const canReply = hasPermission("soul_inbox.reply") && !conversation.closed_at;
  // 接口新的在前;读信从旧到新。
  const rows = [...(messages.data ?? [])].reverse();
  const last = rows.at(-1);
  // 最后一封是灵魂写的、会话还开着 → 待回复,天数从那一封算。
  const waitingDays =
    last && !last.from_officer && !conversation.closed_at
      ? Math.max(0, Math.floor((Date.now() - last.timestamp) / 86_400_000))
      : null;
  // 最新一封全尺寸,前一封缩小;再早的收起,点开才出。
  const hidden = showEarlier ? 0 : Math.max(0, rows.length - 2);

  const submit = () => {
    if (!body.trim() || reply.isPending) return;
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
    <section aria-label={t("soul_inbox.thread_label", { name: conversation.soul_name })} className="min-w-0 px-4 lg:px-6 pt-4 pb-6">
      <header className="flex flex-wrap items-baseline gap-3 pb-3 border-b border-[oklch(var(--color-block))]">
        <h2 className="text-md text-[oklch(var(--color-ink))]">{conversation.soul_name}</h2>
        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{conversation.soul_code}</span>
        {conversation.closed_at && <Badge tone="neutral">{t("soul_inbox.closed")}</Badge>}
        {waitingDays !== null && <Badge tone="warning">{t("soul_inbox.awaiting", { n: String(waitingDays) })}</Badge>}
      </header>
      {messages.isLoading ? (
        <div className="pt-4">
          <ListSkeleton count={2} />
        </div>
      ) : messages.isError ? (
        <QueryError onRetry={() => messages.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("soul_inbox.thread_empty")} />
      ) : (
        <>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowEarlier(true)}
              className={`w-full py-2 border-b ${RULE} text-left text-xs text-[oklch(var(--color-ink-muted))] hover:underline`}
            >
              {t("soul_inbox.earlier", { n: String(hidden) })}
            </button>
          )}
          <ol>
            {rows.slice(hidden).map((m, i, shown) => (
              <Letter
                key={m.event_id}
                m={m}
                conversation={conversation}
                latest={i === shown.length - 1}
                previous={i === shown.length - 2}
              />
            ))}
          </ol>
        </>
      )}
      {canReply && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Composer
            label={t("soul_inbox.reply_label")}
            hint={t("soul_inbox.reply_hint")}
            value={body}
            onChange={setBody}
            onSubmit={submit}
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
              {t("soul_inbox.send")}
              <kbd aria-hidden="true" className="ml-2 font-mono text-2xs opacity-75">
                ⌘⏎
              </kbd>
            </Button>
          </div>
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
  const [folder, setFolder] = useState<Folder>("all");
  const rows = useMemo(() => list.data?.results ?? [], [list.data]);
  const total = list.data?.count ?? rows.length;
  // 第一页就是全部 → 派生文件夹的计数是真的总数;否则不写。
  const complete = rows.length >= total;
  const shown = rows.filter((r) => inFolder(r, folder));
  const selected = shown.find((r) => r.id === selectedId) ?? null;

  const halls = useMemo(() => {
    const seen = new Map<number, InboxConversation>();
    for (const r of rows) if (!seen.has(r.tenant)) seen.set(r.tenant, r);
    return [...seen.values()];
  }, [rows]);
  const folders: { key: Folder; label: string; count: number | null }[] = [
    { key: "all", label: t("soul_inbox.folder.all"), count: total },
    { key: "open", label: t("soul_inbox.folder.open"), count: complete ? rows.filter((r) => !r.closed_at).length : null },
    { key: "closed", label: t("soul_inbox.folder.closed"), count: complete ? rows.filter((r) => r.closed_at).length : null },
  ];
  const hallFolders = halls.map((h) => ({
    key: `hall:${h.tenant}` as Folder,
    label: hallOf(h, locale),
    count: complete ? rows.filter((r) => r.tenant === h.tenant).length : null,
  }));
  const current = [...folders, ...hallFolders].find((f) => f.key === folder) ?? folders[0];

  const folderButton = (f: (typeof folders)[number]) => (
    <li key={f.key}>
      <button
        type="button"
        aria-pressed={folder === f.key}
        onClick={() => setFolder(f.key)}
        className={`w-full flex justify-between items-center px-4 py-2 border-b ${RULE} text-left text-sm text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] ${
          folder === f.key ? CURRENT : ""
        }`}
      >
        <span>{f.label}</span>
        {f.count !== null && <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{f.count}</span>}
      </button>
    </li>
  );

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
        <div className={`grid border ${LINE} lg:grid-cols-[170px_300px_minmax(0,1fr)] xl:grid-cols-[170px_360px_minmax(0,1fr)]`}>
          <nav aria-label={t("soul_inbox.folders")} className={`hidden lg:block py-3 border-r ${LINE}`}>
            <ul>{folders.map(folderButton)}</ul>
            {hallFolders.length > 0 && (
              <>
                <div className={`${SECTION_HEAD} px-4 pt-4 pb-1`}>{t("soul_inbox.by_hall")}</div>
                <ul>{hallFolders.map(folderButton)}</ul>
              </>
            )}
          </nav>

          <div className={`min-w-0 lg:border-r ${LINE}`}>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[oklch(var(--color-block))]">
              <span className="text-sm font-semibold text-[oklch(var(--color-ink))]">{current.label}</span>
              <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{shown.length}</span>
              <span className={`hidden lg:inline ml-auto ${SECTION_HEAD}`}>{t("soul_inbox.newest_first")}</span>
              {/* < 1024 px 的文件夹:收成列表头的下拉。 */}
              <label className="lg:hidden ml-auto">
                <span className="sr-only">{t("soul_inbox.folders")}</span>
                <select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value as Folder)}
                  className={`h-11 px-2 border ${LINE} bg-[oklch(var(--color-canvas))] text-sm text-[oklch(var(--color-ink))]`}
                >
                  {[...folders, ...hallFolders].map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                      {f.count !== null ? ` ${f.count}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {shown.length === 0 ? (
              <p className={`px-4 py-6 ${MUTED_TEXT}`}>{t("soul_inbox.folder_empty")}</p>
            ) : (
              <ul aria-label={t("soul_inbox.list_label")}>
                {shown.map((r) => (
                  <li key={r.id} className={`border-b ${RULE}`}>
                    <button type="button" data-conversation-id={r.id} aria-pressed={r.id === selectedId}
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left px-4 py-3 max-lg:min-h-11 hover:bg-[oklch(var(--color-surface-2))] aria-pressed:bg-[oklch(var(--color-surface-2))] aria-pressed:shadow-[inset_3px_0_0_oklch(var(--color-ink))]">
                      <span className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-[oklch(var(--color-ink))]">{r.soul_name}</span>
                        <span title={hallOf(r, locale)} className="text-xs text-[oklch(var(--color-ink-subtle))] truncate">{hallOf(r, locale)}</span>
                        <span className="ml-auto shrink-0 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                          {r.last_message_at ? formatDateTime(r.last_message_at) : t("soul_inbox.no_messages")}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{r.soul_code}</span>
                        {r.closed_at && <Badge tone="neutral">{t("soul_inbox.closed")}</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`min-w-0 max-lg:border-t ${LINE}`}>
            {selected ? (
              <Thread key={selected.id} conversation={selected} />
            ) : (
              <div className="p-4">
                <EmptyState title={t("soul_inbox.select_hint")} />
              </div>
            )}
          </div>
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
