"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { judgmentApi, type Statute } from "@soulledger/core/api";
import { renderTemplate, type InboxConversation, type InboxFolder, type InboxListParams, type InboxMessage } from "@soulledger/core/api/soul-inbox";
import { judgmentKeys, soulInboxKeys } from "@soulledger/core/query_keys";
import {
  useInboxArchive,
  useInboxConversations,
  useInboxDraft,
  useInboxFolders,
  useInboxMarkRead,
  useInboxMessages,
  useInboxReply,
  useInboxSaveDraft,
  useInboxTemplates,
} from "@soulledger/core/hooks/useSoulInbox";
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
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TemplateManager } from "./TemplateManager";

/*
 * 殿司收件箱:灵魂写给**当前所在**殿司的信(backend/apps/chat/views.py `OfficerInboxViewSet`)。
 * 读要 `soul_inbox.read`(整页),回复另要 `soul_inbox.reply`(没有就不给回复框、草稿与模板)。
 * 回复以殿司名义发出,事件里带上回复人;正文在 Synapse,不在我们的库里,也不进审计。
 * 已关闭的会话(灵魂已转世)只读:不能回复,也不能存草稿。
 *
 * 版式是设计稿 C · 09 的三栏:文件夹 · 信件列表 · 线程;< 1024 px 时文件夹收成列表头的
 * 下拉,线程排在列表下方。
 *
 * 文件夹是**服务端**切的(`folder=`,backend/apps/chat/inbox.py),计数来自 `folders/`,与列表
 * 同一个过滤 —— 所以计数就是翻到底的条数,不是「这一页里有几封」:
 *   全部来信(未归档)· 待回复(最后一封是灵魂写的、未关闭;最早在上)· 已回复 · 草稿 · 归档;
 *   往来中 / 已关闭;按殿。
 * 「谁最后说话」由后端三处维护(灵魂经后端发、官员回复、Synapse 回调),不是页面猜的。
 * 未读、归档、草稿是**这位官员自己的**:同僚读过、归档过、写过草稿,都不改变你看到的。
 *
 * 未读 = 灵魂有一封你读过之后才来的信:行首 6 px 强调色方块 + 名字加粗;打开线程即标已读。
 * 草稿存在我们的库里(不进 Synapse、不进审计),失焦时与停止输入 1 秒后各存一次,
 * 重开页面从服务端恢复;回复发出后服务端清掉它。模板是殿司共用的,插入时在客户端替换
 * `{{soul_name}}` / `{{hall_name}}`。
 *
 * 分页照全站默认:每页 20(`REST_FRAMEWORK.PAGE_SIZE`)。
 *
 * 「转交」(交给别的殿司或同僚)没有做:会话的殿司是收件人,灵魂回归原文明后也不变
 * (apps/chat/models.py),模型里没有「会话换殿」这件事。见 cloud-reports/soul-inbox-folders.md。
 */

const RULE = "border-[oklch(var(--color-rule))]";
const LINE = "border-[oklch(var(--color-line))]";
const MUTED_TEXT = "text-xs text-[oklch(var(--color-ink-subtle))]";
const SECTION_HEAD = "font-mono text-2xs tracking-wide text-[oklch(var(--color-ink-subtle))]";
const CURRENT = "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-ink))] text-[oklch(var(--color-ink))] font-medium";

/** 文件夹栏的一项:服务端的文件夹,或「全部来信」里按状态 / 按殿收窄。 */
type FolderKey = InboxFolder | "status:open" | "status:closed" | `hall:${number}`;

/** 每页条数 = 后端 `REST_FRAMEWORK.PAGE_SIZE`。 */
const PAGE_SIZE = 20;
/** 停止输入多久之后存草稿。 */
const DRAFT_DEBOUNCE_MS = 1000;

/** 殿司展示名,按界面语言(`hall_names`,backend `Tenant.hall_names`);没有就退回租户名。 */
function hallOf(c: InboxConversation, locale: string): string {
  return c.hall_names?.[locale] || c.tenant_name;
}

function errorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

function paramsOf(key: FolderKey): InboxListParams {
  if (key === "status:open") return { folder: "all", status: "open" };
  if (key === "status:closed") return { folder: "all", status: "closed" };
  if (key.startsWith("hall:")) return { folder: "all", hall: Number(key.slice(5)) };
  return { folder: key as InboxFolder };
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
  onBlur,
  toolbar,
  inputRef,
}: {
  label: string;
  hint: ReactNode;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onBlur?: () => void;
  toolbar?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useI18n();
  const { hasPermission } = usePermissions();
  const canCite = hasPermission("judgment.read");
  const id = useId();
  const listId = `${id}-statutes`;
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
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
        {toolbar}
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
          onBlur={() => {
            setSlashAt(null);
            onBlur?.();
          }}
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
      <div id={`${id}-hint`} className={`px-3 py-2 border-t ${LINE} ${MUTED_TEXT}`}>
        {hint}
      </div>
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

type DraftStatus = { kind: "saving" } | { kind: "saved"; at: string | null } | { kind: "failed" } | null;

/**
 * 我的草稿:进线程时从服务端恢复一次,之后回复框拥有这段文字;失焦与停止输入
 * `DRAFT_DEBOUNCE_MS` 之后各存一次(与服务端那份相同就不存)。恢复之前一个字都不存 ——
 * 否则空白的回复框会先把服务端的草稿清掉。
 */
function useDraft(conversationId: string, enabled: boolean) {
  const draft = useInboxDraft(conversationId, enabled);
  const save = useInboxSaveDraft();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<DraftStatus>(null);
  // 服务端此刻的那一份;null = 还没恢复。
  const saved = useRef<string | null>(null);

  useEffect(() => {
    if (saved.current !== null || !draft.data) return;
    saved.current = draft.data.draft;
    if (draft.data.draft) {
      setBody((typed) => typed || (draft.data?.draft ?? ""));
      setStatus({ kind: "saved", at: draft.data.draft_saved_at });
    }
  }, [draft.data]);

  const { mutate } = save;
  const persist = useCallback(
    (text: string) => {
      if (!enabled || saved.current === null || text === saved.current) return;
      if (!text.trim() && !saved.current) return;
      setStatus({ kind: "saving" });
      mutate(
        { id: conversationId, body: text },
        {
          onSuccess: (state) => {
            saved.current = state.draft;
            setStatus(state.draft ? { kind: "saved", at: state.draft_saved_at } : null);
          },
          onError: () => setStatus({ kind: "failed" }),
        }
      );
    },
    [conversationId, enabled, mutate]
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => persist(body), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body, enabled, persist]);

  /** 回复发出之后:服务端已清掉它。 */
  const sent = () => {
    saved.current = "";
    setBody("");
    setStatus(null);
  };
  return { body, setBody, status, persist, sent };
}

function Thread({ conversation }: { conversation: InboxConversation }) {
  const { t, locale, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const messages = useInboxMessages(conversation.id);
  const reply = useInboxReply();
  const markRead = useInboxMarkRead();
  const archive = useInboxArchive();
  const [showEarlier, setShowEarlier] = useState(false);
  const [managing, setManaging] = useState(false);
  const canReply = hasPermission("soul_inbox.reply") && !conversation.closed_at;
  const draft = useDraft(conversation.id, canReply);
  const templates = useInboxTemplates(canReply);
  const input = useRef<HTMLTextAreaElement | null>(null);
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

  // 信读到了才算读过:线程加载成功之后标已读,一次。
  const marked = useRef(false);
  const { mutate: mark } = markRead;
  useEffect(() => {
    if (!messages.isSuccess || !conversation.unread || marked.current) return;
    marked.current = true;
    mark(conversation.id);
  }, [messages.isSuccess, conversation.unread, conversation.id, mark]);

  const submit = () => {
    if (!draft.body.trim() || reply.isPending) return;
    reply.mutate(
      { id: conversation.id, body: draft.body },
      {
        onSuccess: () => {
          draft.sent();
          showToast(t("soul_inbox.sent"), "success");
        },
        onError: (error) => {
          const code = errorCode(error);
          showToast(code ? t(`soul_inbox.errors.${code}`) : t("soul_inbox.failed"), "error");
        },
      }
    );
  };

  const toggleArchive = () =>
    archive.mutate(
      { id: conversation.id, archived: !conversation.archived },
      {
        onSuccess: () =>
          showToast(t(conversation.archived ? "soul_inbox.unarchived_done" : "soul_inbox.archived_done"), "success"),
        onError: () => showToast(t("soul_inbox.failed"), "error"),
      }
    );

  /** 模板在客户端填好占位符,插到光标处(没有光标就接在末尾)。 */
  const insertTemplate = (id: string) => {
    const tpl = templates.data?.find((x) => x.id === id);
    if (!tpl) return;
    const text = renderTemplate(tpl.body, { soul_name: conversation.soul_name, hall_name: hallOf(conversation, locale) });
    const el = input.current;
    const [from, to] = el ? [el.selectionStart, el.selectionEnd] : [draft.body.length, draft.body.length];
    draft.setBody(draft.body.slice(0, from) + text + draft.body.slice(to));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from + text.length, from + text.length);
    });
  };

  const draftLine =
    draft.status?.kind === "saving"
      ? t("soul_inbox.draft_saving")
      : draft.status?.kind === "failed"
        ? t("soul_inbox.draft_failed")
        : draft.status?.kind === "saved"
          ? t("soul_inbox.draft_saved", { time: draft.status.at ? formatDateTime(draft.status.at) : "" })
          : null;

  return (
    <section aria-label={t("soul_inbox.thread_label", { name: conversation.soul_name })} className="min-w-0 px-4 lg:px-6 pt-4 pb-6">
      <header className="flex flex-wrap items-baseline gap-3 pb-3 border-b border-[oklch(var(--color-block))]">
        <h2 className="text-md text-[oklch(var(--color-ink))]">{conversation.soul_name}</h2>
        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{conversation.soul_code}</span>
        {conversation.closed_at && <Badge tone="neutral">{t("soul_inbox.closed")}</Badge>}
        {waitingDays !== null && <Badge tone="warning">{t("soul_inbox.awaiting", { n: String(waitingDays) })}</Badge>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" loading={archive.isPending} onClick={toggleArchive}>
          {t(conversation.archived ? "soul_inbox.unarchive" : "soul_inbox.archive")}
        </Button>
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
            hint={
              <span className="flex flex-wrap gap-x-3">
                <span>{t("soul_inbox.reply_hint")}</span>
                {draftLine && (
                  <span role="status" className={draft.status?.kind === "failed" ? "text-[oklch(var(--color-danger))]" : ""}>
                    {draftLine}
                  </span>
                )}
              </span>
            }
            value={draft.body}
            onChange={draft.setBody}
            onSubmit={submit}
            onBlur={() => draft.persist(draft.body)}
            inputRef={input}
            toolbar={
              <span className="ml-auto flex items-center gap-2">
                <label>
                  <span className="sr-only">{t("soul_inbox.template.pick")}</span>
                  <select
                    value=""
                    onChange={(e) => insertTemplate(e.target.value)}
                    className={`h-7 max-w-[12rem] px-1 border ${LINE} bg-[oklch(var(--color-canvas))] text-xs text-[oklch(var(--color-ink))]`}
                  >
                    <option value="">
                      {templates.data?.length ? t("soul_inbox.template.pick") : t("soul_inbox.template.none")}
                    </option>
                    {templates.data?.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setManaging(true)} className="text-xs underline-offset-2 hover:underline">
                  {t("soul_inbox.template.manage")}
                </button>
              </span>
            }
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => draft.persist(draft.body)} disabled={!draft.body.trim()}>
              {t("soul_inbox.save_draft")}
            </Button>
            <Button type="submit" variant="primary" loading={reply.isPending} disabled={!draft.body.trim()}>
              {t("soul_inbox.send")}
              <kbd aria-hidden="true" className="ml-2 font-mono text-2xs opacity-75">
                ⌘⏎
              </kbd>
            </Button>
          </div>
          <TemplateManager isOpen={managing} onClose={() => setManaging(false)} />
        </form>
      )}
    </section>
  );
}

function SoulInboxContent() {
  const { t, formatDateTime, locale } = useI18n();
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState<FolderKey>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const counts = useInboxFolders();
  const list = useInboxConversations({ page, ...paramsOf(folder) });
  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const n = counts.data;

  const choose = (key: FolderKey) => {
    setFolder(key);
    setPage(1);
  };

  const folders: { key: FolderKey; label: string; count: number | null }[] = [
    { key: "all", label: t("soul_inbox.folder.all"), count: n?.all ?? null },
    { key: "awaiting_reply", label: t("soul_inbox.folder.awaiting_reply"), count: n?.awaiting_reply ?? null },
    { key: "replied", label: t("soul_inbox.folder.replied"), count: n?.replied ?? null },
    { key: "drafts", label: t("soul_inbox.folder.drafts"), count: n?.drafts ?? null },
    { key: "archived", label: t("soul_inbox.folder.archived"), count: n?.archived ?? null },
  ];
  const statusFolders: typeof folders = [
    { key: "status:open", label: t("soul_inbox.folder.open"), count: n?.open ?? null },
    { key: "status:closed", label: t("soul_inbox.folder.closed"), count: n?.closed ?? null },
  ];
  const hallFolders: typeof folders = (n?.halls ?? []).map((h) => ({
    key: `hall:${h.tenant}` as FolderKey,
    label: h.hall_names[locale] || h.hall_names["zh-Hans"] || String(h.tenant),
    count: h.count,
  }));
  const every = [...folders, ...statusFolders, ...hallFolders];
  const current = every.find((f) => f.key === folder) ?? folders[0];
  // 整个收件箱(含归档)一封都没有:整页空态;否则是「这个文件夹空」。
  const nothingAtAll = n !== undefined && n.all === 0 && n.archived === 0;

  const folderButton = (f: (typeof folders)[number]) => (
    <li key={f.key}>
      <button
        type="button"
        aria-pressed={folder === f.key}
        onClick={() => choose(f.key)}
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
      {list.isLoading && !list.data ? (
        <ListSkeleton count={3} />
      ) : list.isError && !list.data ? (
        <QueryError onRetry={() => list.refetch()} />
      ) : nothingAtAll ? (
        <EmptyState title={t("soul_inbox.empty")} reason={t("soul_inbox.empty_reason")} />
      ) : (
        <div className={`grid border ${LINE} lg:grid-cols-[170px_300px_minmax(0,1fr)] xl:grid-cols-[170px_360px_minmax(0,1fr)]`}>
          <nav aria-label={t("soul_inbox.folders")} className={`hidden lg:block py-3 border-r ${LINE}`}>
            <ul>{folders.map(folderButton)}</ul>
            <ul className="mt-3">{statusFolders.map(folderButton)}</ul>
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
              <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{count}</span>
              <span className={`hidden lg:inline ml-auto ${SECTION_HEAD}`}>
                {t(folder === "awaiting_reply" ? "soul_inbox.oldest_first" : "soul_inbox.newest_first")}
              </span>
              {/* < 1024 px 的文件夹:收成列表头的下拉。 */}
              <label className="lg:hidden ml-auto">
                <span className="sr-only">{t("soul_inbox.folders")}</span>
                <select
                  value={folder}
                  onChange={(e) => choose(e.target.value as FolderKey)}
                  className={`h-11 px-2 border ${LINE} bg-[oklch(var(--color-canvas))] text-sm text-[oklch(var(--color-ink))]`}
                >
                  {every.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                      {f.count !== null ? ` ${f.count}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {rows.length === 0 ? (
              <p className={`px-4 py-6 ${MUTED_TEXT}`}>{t("soul_inbox.folder_empty")}</p>
            ) : (
              <ul aria-label={t("soul_inbox.list_label")}>
                {rows.map((r) => (
                  <li key={r.id} className={`border-b ${RULE}`}>
                    <button type="button" data-conversation-id={r.id} data-unread={r.unread || undefined}
                      aria-pressed={r.id === selectedId}
                      onClick={() => setSelectedId(r.id)}
                      className="w-full flex gap-2 text-left px-4 py-3 max-lg:min-h-11 hover:bg-[oklch(var(--color-surface-2))] aria-pressed:bg-[oklch(var(--color-surface-2))] aria-pressed:shadow-[inset_3px_0_0_oklch(var(--color-ink))]">
                      {/* 未读:6 px 强调色方块(设计稿 C · 09:方块,不用圆点)。读屏读的是旁边那句。 */}
                      <span aria-hidden="true" className={`mt-[7px] size-1.5 flex-none ${r.unread ? "bg-[oklch(var(--color-accent))]" : ""}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={`text-sm text-[oklch(var(--color-ink))] ${r.unread ? "font-semibold" : "font-normal"}`}>
                            {r.soul_name}
                          </span>
                          {r.unread && <span className="sr-only">{t("soul_inbox.unread")}</span>}
                          <span title={hallOf(r, locale)} className="text-xs text-[oklch(var(--color-ink-subtle))] truncate">{hallOf(r, locale)}</span>
                          <span className="ml-auto shrink-0 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                            {r.last_message_at ? formatDateTime(r.last_message_at) : t("soul_inbox.no_messages")}
                          </span>
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{r.soul_code}</span>
                          {r.has_draft && <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{t("soul_inbox.folder.drafts")}</span>}
                          {r.closed_at && <Badge tone="neutral">{t("soul_inbox.closed")}</Badge>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {count > PAGE_SIZE && (
              <div className="px-4 py-2">
                <Pagination page={page} totalPages={totalPages} count={count} onPageChange={setPage} />
              </div>
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
