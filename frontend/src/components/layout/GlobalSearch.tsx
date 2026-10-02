"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import { judgmentApi, soulsApi, type Judgment, type PaginatedResponse, type SoulListItem, type Statute } from "@soulledger/core/api";
import { citationOf } from "@soulledger/core/config/statuteCitation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { menuTranslationKey } from "@/src/lib/menuI18n";
import { shortIdentifier } from "@/src/lib/domainDisplay";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { SoulStateBadge, VerdictBadge } from "@/src/components/ui/StatusBadge";

/**
 * 全局搜索(规范 v3 A8,`docs/design-handoff/v3-pages/A8-search.md`)。
 *
 * 四类,顺序写死:案件 → 灵魂 → 律条 → 页面。前三类各走自己列表接口的 `?search=`,各自返回、
 * 各自显示,谁也不等谁;某类 403 整类不出现,其它失败只这一类显示「加载失败 · 重试」。
 * 「页面」从已加载的侧栏菜单里筛,不发请求。没输入时列最近打开的 5 条(按用户存在本地)。
 *
 * 不自动跳:完整案号那一条排在案件组第一、标「案号完全一致」并默认选中,还是要按一下 ↵。
 */

export const SEARCH_DEBOUNCE_MS = 200;
export const GROUP_LIMIT = 5;
export const RECENT_LIMIT = 5;
/** 说明与提示里的案号示例(Design 的原文)。放在代码里而不是语言包:它是一个编号,不是一句话。 */
const CASE_NUMBER_EXAMPLE = "CN-2026-0042";

type Kind = "judgment" | "soul" | "statute" | "page";
export const GROUP_ORDER: readonly Kind[] = ["judgment", "soul", "statute", "page"];
const GROUP_LABEL: Record<Kind, string> = {
  judgment: "search.group_judgments",
  soul: "search.group_souls",
  statute: "search.group_statutes",
  page: "search.group_pages",
};
const VIEW_ALL: Partial<Record<Kind, string>> = {
  judgment: "search.view_all_judgments",
  soul: "search.view_all_souls",
  statute: "search.view_all_statutes",
};

/** 存进本地的一条「最近打开」:只存画这一行要的字,不存整条记录。 */
export interface RecentItem {
  kind: Kind;
  id: string;
  href: string;
  title: string;
  sub?: string;
}

interface Option {
  key: string;
  href: string;
  /** 打开时记进「最近打开」的那一条;「查看全部」没有。 */
  recent?: RecentItem;
  node: ReactNode;
  /** 律条两行,行高 64;其余 48。 */
  tall?: boolean;
  viewAll?: boolean;
}

const recentKey = (userId: number | string | undefined) => `soulledger.search.recent.${userId ?? "anon"}`;

export function readRecent(userId: number | string | undefined): RecentItem[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function pushRecent(userId: number | string | undefined, item: RecentItem): void {
  try {
    const next = [item, ...readRecent(userId).filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    /* 隐私模式等:这一次不记,搜索照常。 */
  }
}

/** 命中字:600 + 下划线,**不用颜色**(Design §3)。大小写不敏感。 */
export function Hit({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <span key={at} data-search-hit="" className="font-semibold underline underline-offset-3">
        {text.slice(at, at + needle.length)}
      </span>
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/** 律条第二行:命中处居中 —— 从命中前 24 个字起截,前面补省略号;尾部交给 CSS 一行省略。 */
function excerpt(text: string, q: string): string {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return at > 24 ? `…${text.slice(at - 24)}` : text;
}

function flattenPages(menus: readonly SidebarMenu[]): SidebarMenu[] {
  return menus.flatMap((m) => [...(!isDirectory(m) && m.path ? [m] : []), ...flattenPages(m.children ?? [])]);
}

const isForbidden = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status === 403;
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const MUTED = "text-[oklch(var(--color-ink-muted))]";
const SUBTLE = "text-[oklch(var(--color-ink-subtle))]";
const LINE_STRONG = "border-[oklch(var(--color-line-strong))]";
const KEYCAP = `border ${LINE_STRONG} px-[6px] font-mono text-xs ${MUTED}`;

export function GlobalSearch({ menus }: { menus: readonly SidebarMenu[] }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  /** 用户用 ↑↓ / 指针挑过的那一行;没挑过就是第一行(完整案号那一条因此默认选中)。 */
  const [picked, setPicked] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const desktopEntry = useRef<HTMLButtonElement>(null);
  const mobileEntry = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const show = (from?: HTMLButtonElement | null) => {
    const narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 768px)").matches;
    opener.current = from ?? (narrow ? mobileEntry.current : desktopEntry.current);
    setRecent(readRecent(user?.id));
    setInput("");
    setTerm("");
    setPicked(null);
    setOpen(true);
  };

  // ⌘K / Ctrl K(不用 `/`:律条和表单里常在打字)。修饰键组合,在输入框里也接。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (!open) show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const enabled = open && term.length > 0;
  const common = { enabled, placeholderData: keepPreviousData, retry: false, staleTime: 30_000 } as const;
  const judgments = useQuery({
    ...common,
    queryKey: ["global-search", "judgment", term],
    queryFn: async () => (await judgmentApi.list({ search: term })).data,
  });
  const souls = useQuery({
    ...common,
    queryKey: ["global-search", "soul", term],
    queryFn: async () => (await soulsApi.list({ search: term })).data,
  });
  const statutes = useQuery({
    ...common,
    queryKey: ["global-search", "statute", term],
    queryFn: async () => (await judgmentApi.statutes({ search: term })).data,
  });
  const pages = useMemo(() => {
    const q = term.toLowerCase();
    if (!q) return [];
    return flattenPages(menus).filter((m) => {
      const key = menuTranslationKey(m);
      return [m.name, m.path ?? "", key ? t(key) : ""].some((s) => s.toLowerCase().includes(q));
    });
  }, [menus, term, t]);

  const close = () => setOpen(false);
  const go = (option: Option, newTab: boolean) => {
    if (option.recent) {
      pushRecent(user?.id, option.recent);
      setRecent(readRecent(user?.id));
    }
    if (newTab) {
      window.open(option.href, "_blank", "noopener,noreferrer");
      return;
    }
    close();
    router.push(option.href);
  };

  const pending = input.trim() !== term;
  const searching = input.trim().length > 0;
  const corpusName = (c: string) => t(`judgment.statute_corpus.${c}`);

  /** 一类的状态。`loading` 只在这一类还没有任何结果可留时出现(首次:骨架);之后保留上一次的结果。 */
  type Section =
    | { kind: Kind; state: "hidden" }
    | { kind: Kind; state: "loading" }
    | { kind: Kind; state: "error"; retry: () => void }
    | { kind: Kind; state: "ok"; options: Option[]; total: number };

  function remote<T>(
    kind: Kind,
    query: UseQueryResult<PaginatedResponse<T>>,
    toOption: (row: T) => Option,
    order: (rows: T[]) => T[] = (rows) => rows
  ): Section {
    if (query.isError) return isForbidden(query.error) ? { kind, state: "hidden" } : { kind, state: "error", retry: () => void query.refetch() };
    if (!query.data) return { kind, state: "loading" };
    const options = order(query.data.results).slice(0, GROUP_LIMIT).map(toOption);
    const total = query.data.count;
    if (total > GROUP_LIMIT && VIEW_ALL[kind]) {
      const href = kind === "statute" ? `/corpus?q=${encodeURIComponent(term)}` : `/${kind === "soul" ? "souls" : "judgment"}?q=${encodeURIComponent(term)}`;
      options.push({
        key: `${kind}:all`,
        href,
        viewAll: true,
        node: <span className={`text-sm ${MUTED}`}>{t(VIEW_ALL[kind]!, { n: String(total) })}</span>,
      });
    }
    return { kind, state: "ok", options, total };
  }

  const exact = (j: Judgment) => !!term && j.case_number?.toLowerCase() === term.toLowerCase();
  const sections: Section[] = !searching
    ? []
    : [
        remote<Judgment>("judgment", judgments, (j) => ({
          key: `judgment:${j.id}`,
          href: `/judgment/${j.id}`,
          recent: { kind: "judgment", id: j.id, href: `/judgment/${j.id}`, title: j.case_number, sub: [j.soul_name, j.court].filter(Boolean).join(" · ") },
          node: (
            <>
              <span className="min-w-0 flex-1 truncate" title={[j.case_number, j.soul_name, j.court].filter(Boolean).join(" · ")}>
                <span className="font-mono"><Hit text={j.case_number ?? ""} q={term} /></span>
                <span className={MUTED}> · <Hit text={j.soul_name ?? ""} q={term} />{j.court ? ` · ${j.court}` : ""}</span>
              </span>
              {exact(j) && (
                <span data-testid="search-exact-case" className="shrink-0 bg-[oklch(var(--color-ink))] px-[6px] text-xs text-[oklch(var(--color-surface-1))]">
                  {t("search.exact_case")}
                </span>
              )}
              {j.verdict && <VerdictBadge verdict={j.verdict} className="shrink-0" />}
            </>
          ),
          // 完整案号那一条排第一(案件组本来就在最前,所以它就是第一行、默认选中)。
        }), (rows) => [...rows].sort((a, b) => Number(exact(b)) - Number(exact(a)))),
        remote<SoulListItem>("soul", souls, (s) => ({
          key: `soul:${s.id}`,
          href: `/souls/${s.id}`,
          recent: { kind: "soul", id: s.id, href: `/souls/${s.id}`, title: s.name, sub: shortIdentifier(s.id) },
          node: (
            <>
              <span className="min-w-0 flex-1 truncate" title={`${s.name} · ${shortIdentifier(s.id)}`}>
                <Hit text={s.name} q={term} />
                <span className={`text-sm ${MUTED}`}>
                  {" · "}<span className="font-mono">{shortIdentifier(s.id)}</span>{" · "}
                  <DomainEnum namespace="souls.civilizations" value={s.civilization} />
                </span>
              </span>
              <SoulStateBadge state={s.current_state} className="shrink-0" />
            </>
          ),
        })),
        remote<Statute>("statute", statutes, (s) => {
          const citation = citationOf(s, corpusName);
          return {
            key: `statute:${s.id}`,
            href: `/corpus?article=${s.id}`,
            tall: true,
            recent: { kind: "statute", id: s.id, href: `/corpus?article=${s.id}`, title: citation, sub: s.display_title },
            node: (
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={`${citation} ${s.display_title ?? ""}`}>
                  {citation} <Hit text={s.display_title ?? ""} q={term} />
                </span>
                <span className={`block truncate font-serif text-sm ${MUTED}`} title={s.display_text ?? ""}>
                  <Hit text={excerpt(s.display_text ?? "", term)} q={term} />
                </span>
              </span>
            ),
          };
        }),
        pending && !term
          ? { kind: "page", state: "loading" }
          : {
              kind: "page",
              state: "ok",
              total: pages.length,
              options: pages.slice(0, GROUP_LIMIT).map((m) => ({
                key: `page:${m.id}`,
                href: m.path!,
                recent: { kind: "page", id: String(m.id), href: m.path!, title: m.name, sub: m.path! },
                node: (
                  <span className="min-w-0 flex-1 truncate" title={`${m.name} · ${m.path}`}>
                    <Hit text={m.name} q={term} />
                    <span className={`font-mono text-sm ${MUTED}`}> · <Hit text={m.path!} q={term} /></span>
                  </span>
                ),
              })),
            },
      ];

  const recentOptions: Option[] = recent.map((r) => ({
    key: `recent:${r.kind}:${r.id}`,
    href: r.href,
    recent: r,
    node: (
      <>
        <span className="min-w-0 flex-1 truncate" title={[r.title, r.sub].filter(Boolean).join(" · ")}>
          {r.kind === "judgment" ? <span className="font-mono">{r.title}</span> : r.title}
          {r.sub ? <span className={`text-sm ${MUTED}`}> · {r.sub}</span> : null}
        </span>
        <span className={`shrink-0 text-2xs ${SUBTLE}`}>{t(GROUP_LABEL[r.kind])}</span>
      </>
    ),
  }));

  const visible = sections.filter((s) => s.state !== "hidden" && !(s.state === "ok" && s.options.length === 0));
  const options: Option[] = searching
    ? visible.flatMap((s) => (s.state === "ok" ? s.options : []))
    : recentOptions;
  const activeKey = picked && options.some((o) => o.key === picked) ? picked : options[0]?.key ?? null;
  const activeIndex = options.findIndex((o) => o.key === activeKey);
  const optionId = (key: string) => `${listboxId}-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const settled = sections.length > 0 && sections.every((s) => s.state === "hidden" || s.state === "ok") && !pending;
  const noResults = searching && settled && options.length === 0;
  const anyShown = visible.some((s) => s.state === "ok");
  const busy = searching && anyShown && (pending || judgments.isFetching || souls.isFetching || statutes.isFetching);
  const announce = searching && !pending
    ? sections
        .filter((s): s is Extract<Section, { state: "ok" }> => s.state === "ok")
        .map((s) => t("search.announce_group", { group: t(GROUP_LABEL[s.kind]), n: String(s.total) }))
        .join(" · ")
    : "";

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return;
      const next = e.key === "ArrowDown" ? Math.min(activeIndex + 1, options.length - 1) : Math.max(activeIndex - 1, 0);
      setPicked(options[next].key);
      document.getElementById(optionId(options[next].key))?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter" && activeIndex !== -1) {
      e.preventDefault();
      go(options[activeIndex], e.metaKey || e.ctrlKey);
    }
  };

  const renderOption = (o: Option) => {
    const selected = o.key === activeKey;
    return (
      <div
        key={o.key}
        id={optionId(o.key)}
        role="option"
        aria-selected={selected}
        data-option-key={o.key}
        tabIndex={-1}
        onPointerMove={() => setPicked(o.key)}
        // mousedown + preventDefault:焦点留在输入框(combobox 的焦点从不离开它),↑↓ 照常接着用。
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          go(o, e.metaKey || e.ctrlKey);
        }}
        className={`flex cursor-pointer items-center gap-3 px-4 py-1 text-[oklch(var(--color-ink))] ${
          o.viewAll ? "min-h-10" : o.tall ? "min-h-16" : "min-h-12"
        } ${selected ? "bg-[oklch(var(--color-surface-2))]" : ""}`}
      >
        {o.node}
        {selected && <span aria-hidden="true" className={`shrink-0 font-mono text-sm ${MUTED} max-[768px]:hidden`}>↵</span>}
      </div>
    );
  };

  const groupHeading = (id: string, label: string, count?: ReactNode) => (
    <div id={id} className={`flex items-baseline gap-2 px-4 pb-1 pt-2 text-2xs ${SUBTLE}`}>
      <span>{label}</span>
      {count !== undefined && <span className="font-mono tracking-normal">{count}</span>}
    </div>
  );

  const renderSection = (s: Section) => {
    if (s.state === "hidden" || (s.state === "ok" && s.options.length === 0)) return null;
    const headingId = `${listboxId}-${s.kind}-label`;
    const label = t(GROUP_LABEL[s.kind]);
    return (
      <div key={s.kind} role="group" aria-labelledby={headingId} data-search-group={s.kind} className="pb-2">
        {s.state === "ok"
          ? groupHeading(headingId, label, s.total > GROUP_LIMIT ? t("search.count_more", { shown: String(GROUP_LIMIT), n: String(s.total) }) : s.total)
          : groupHeading(headingId, label)}
        {s.state === "loading" &&
          [0, 1, 2].map((i) => (
            <div key={i} data-testid="search-skeleton" aria-hidden="true" className="flex min-h-12 items-center gap-3 px-4">
              <span className="h-3 w-24 bg-[oklch(var(--color-surface-2))]" />
              <span className="h-3 w-48 bg-[oklch(var(--color-surface-2))]" />
            </div>
          ))}
        {s.state === "error" && (
          <div data-testid="search-group-error" className="flex min-h-12 items-center gap-3 px-4">
            <span className="shrink-0 text-sm text-[oklch(var(--color-danger))]">! {t("search.load_failed")}</span>
            <span className={`min-w-0 flex-1 truncate text-sm ${MUTED}`}>{t("search.others_unaffected")}</span>
            <button
              type="button"
              onClick={s.retry}
              className={`h-9 shrink-0 border ${LINE_STRONG} px-3 text-sm font-medium text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]`}
            >
              {t("common.retry")}
            </button>
          </div>
        )}
        {s.state === "ok" && s.options.map(renderOption)}
      </div>
    );
  };

  const shortcut = isMac() ? "⌘K" : "Ctrl K";

  return (
    <>
      <button
        ref={desktopEntry}
        type="button"
        data-testid="global-search-entry"
        onClick={(e) => show(e.currentTarget)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className={`hidden h-9 w-60 shrink-0 items-center gap-2 border ${LINE_STRONG} rounded-(--radius-control) bg-[oklch(var(--color-surface-1))] px-3 text-sm ${SUBTLE} hover:text-[oklch(var(--color-ink))] min-[769px]:flex`}
      >
        <Search aria-hidden="true" size={16} strokeWidth={1.5} />
        <span className="flex-1 text-left">{t("search.aria_label")}</span>
        <kbd className={KEYCAP}>{shortcut}</kbd>
      </button>
      <button
        ref={mobileEntry}
        type="button"
        data-testid="global-search-entry-mobile"
        onClick={(e) => show(e.currentTarget)}
        aria-haspopup="dialog"
        aria-label={t("search.aria_label")}
        className={`flex h-11 w-11 shrink-0 items-center justify-center ${MUTED} hover:text-[oklch(var(--color-ink))] min-[769px]:hidden`}
      >
        <Search aria-hidden="true" size={20} strokeWidth={1.5} />
      </button>

      <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-opacity duration-fast ease-enter data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-press data-ending-style:ease-exit" />
          <Dialog.Viewport className="fixed inset-0 z-dialog flex items-start justify-center min-[769px]:pt-[96px]">
            {/* 开 160 ease-enter,−4→0;关 80 ease-exit,不位移。≤768 全屏:开 240 自下 16 上滑,关 160。
                减少动效:不带 data-motion,全局那条 1ms 规则让它瞬时。 */}
            <Dialog.Popup
              initialFocus={inputRef}
              finalFocus={opener}
              data-testid="global-search"
              className={`flex h-dvh w-full flex-col bg-[oklch(var(--color-surface-1))] text-md font-normal transition-[opacity,translate] duration-fast ease-enter data-starting-style:-translate-y-1 data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-press data-ending-style:ease-exit max-[768px]:duration-base max-[768px]:data-starting-style:translate-y-4 max-[768px]:data-ending-style:translate-y-4 max-[768px]:data-ending-style:duration-fast min-[769px]:h-auto min-[769px]:max-h-[560px] min-[769px]:w-[640px] min-[769px]:rounded-panel min-[769px]:border ${LINE_STRONG} min-[769px]:shadow-overlay`}
            >
              <Dialog.Title className="sr-only">{t("search.dialog_label")}</Dialog.Title>
              <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[oklch(var(--color-line))] px-4">
                <Search aria-hidden="true" size={20} strokeWidth={1.5} className={`shrink-0 ${MUTED}`} />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={options.length > 0}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
                  aria-label={t("search.dialog_label")}
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={input}
                  placeholder={t("search.input_placeholder")}
                  onChange={(e) => { setInput(e.target.value); setPicked(null); }}
                  onKeyDown={onKeyDown}
                  className="h-full min-w-0 flex-1 bg-transparent text-md font-normal text-[oklch(var(--color-ink))] outline-none placeholder:text-[oklch(var(--color-ink-subtle))]"
                />
                <Dialog.Close className={`${KEYCAP} max-[768px]:hidden`}>esc</Dialog.Close>
                <Dialog.Close className="h-11 shrink-0 text-sm font-medium text-[oklch(var(--color-ink))] min-[769px]:hidden">{t("search.cancel")}</Dialog.Close>
              </div>
              <div aria-hidden="true" className="h-0.5 shrink-0 overflow-hidden bg-[oklch(var(--color-surface-2))]">
                {busy && <div data-testid="search-progress" className="h-full w-[38%] animate-search-progress bg-[oklch(var(--color-ink))]" />}
              </div>

              <div role="listbox" id={listboxId} aria-label={t("search.dialog_label")} className="min-h-0 flex-1 overflow-y-auto py-2">
                {searching ? (
                  GROUP_ORDER.map((kind) => sections.find((s) => s.kind === kind)).map((s) => s && renderSection(s))
                ) : recentOptions.length > 0 ? (
                  <div role="group" aria-labelledby={`${listboxId}-recent-label`}>
                    {groupHeading(`${listboxId}-recent-label`, t("search.group_recent"))}
                    {recentOptions.map(renderOption)}
                  </div>
                ) : null}
              </div>
              {noResults && (
                <div data-testid="search-no-results" className="flex flex-col gap-2 px-6 pb-6 pt-[40px]">
                  <p className="font-title text-lg text-[oklch(var(--color-ink))]">{t("search.no_results_title", { q: term })}</p>
                  <p className={`text-sm ${MUTED}`}>{t("search.no_results_body", { example: CASE_NUMBER_EXAMPLE })}</p>
                </div>
              )}
              {!searching && (
                <p className={`px-4 py-3 text-sm ${SUBTLE}`}>{t("search.hint", { example: CASE_NUMBER_EXAMPLE })}</p>
              )}
              <p role="status" className="sr-only">{announce}</p>
              <div className={`hidden h-9 shrink-0 items-center gap-[20px] border-t border-[oklch(var(--color-line))] px-4 font-mono text-xs ${MUTED} min-[769px]:flex`}>
                <span>↑↓ {t("search.footer_select")}</span>
                <span>↵ {t("search.footer_open")}</span>
                <span>{isMac() ? "⌘↵" : "Ctrl ↵"} {t("search.footer_new_tab")}</span>
                <span className="ml-auto">esc {t("common.close")}</span>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
