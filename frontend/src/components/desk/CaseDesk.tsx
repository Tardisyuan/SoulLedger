"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dossiersApi } from "@soulledger/core/api/dossiers";
import { concludeRefusalOf, judgmentApi, type JudgmentQueueSource } from "@soulledger/core/api/judgment";
import { UNDO_MS, useStagedCommit } from "@soulledger/core/hooks/useJudgmentQueue";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { courtLabel } from "@soulledger/core/domain/courts";
import { formatIsoDay } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { CaseNumber, DomainEnum } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { isTypingTarget, useHotkeys, useShortcutHelp } from "@/src/lib/hotkeys";
import { useOverflowEnd } from "@/src/hooks/useOverflowEnd";
import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";
import { DESK_GROUPS, deskTag, heldBeforeClaim, matchesSearch, onDeskCount, overviewParts, rowNotes, sourceChips, sourceLabel, step } from "./deskRules";
import { claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { SealReadbackDialog, sealReadbackEnabled } from "@/src/components/judgment/SealReadback";
import { verdictNamespace } from "@/src/lib/domainNames";
import { OpenCase } from "./OpenCase";
import type { DeskVerdictDraft } from "./VerdictRail";
import s from "./desk.module.css";

/**
 * 案卷台(Design 第三十批 第 2 步):门栏(AppLayout 的 `DoorRail`)右边,左是案卷摞(340,第四十六批),中间摊开的一份,右是判栏。
 * 摞:标题、概览行、来源 chip、搜索(`/`)、四组 —— 我认领 / 待定 / 待认领 / 他人手上(最后,只读)。
 * 键:J / K 上下一件、↵ 打开卷宗、C 认领、/ 搜索;打字时不接,单键总开关关掉时也不接(`lib/hotkeys.ts`)。
 * 393:一栏;点开一件是整屏(一次导航,`?case=<id>`,系统返回回到摞),「‹ 案卷台」回来,「第 n / N 件」。
 *
 * 与官员端 `mobile-officer/src/screens/queue.tsx` 同一套规矩;来源读服务端的 `source`(`deskRules.sourceOf`)。
 *
 * 摞读一个请求:`GET /dossiers/desk/`(四组头几件 + 计数 + 本月已结;此前是四个分组列表、两次 queue-counts 与 hall-stats)。
 * 四组由服务端出自同一个快照、互斥,不再在前端去重。
 *
 * 就地判(用户 2026-11-14,fe-ia §3.5):右栏是判栏(`VerdictRail`,懒加载)。1–4 选、⌘⏎ 落印 —— 与快审同一个承诺:
 * 落印即这一行划线滑出(440ms,减少动态时 120ms 淡出)、选中到下一件,裁决在 5 秒撤回窗口(`useStagedCommit`)到点、落下一印、
 * 或离开本页时才发 `conclude/`;⌘Z(U 照旧)或撤回条收回。撤回条在判栏底部,盖住落印区(第四十六批第 4 条)。偏好「落印前先确认」打开时改走回读层(`SealReadback.tsx`),当场发、不计时。
 * 选中一件约 150ms 后预取下一件的卷宗,J 落下时不等。
 */
const SHORTCUTS = [
  { key: "J · K", label: "caseDesk.keys.move" },
  { key: "↵", label: "caseDesk.keys.open" },
  { key: "C", label: "caseDesk.keys.claim" },
  { key: "1–4", label: "judgment.queue.key_select" },
  { key: "⌘⏎", label: "judgment.queue.key_seal" },
  { key: "⌘Z · U", label: "judgment.queue.key_undo" },
  { key: "N", label: "judgment.queue.key_notes" },
  { key: "/", label: "caseDesk.keys.search" },
] as const;

/** 判栏只在这一页、只在桌面用到:不进案卷台的首屏包(fe-perf:懒加载)。 */
const VerdictRail = dynamic(() => import("./VerdictRail"), { ssr: false, loading: () => null });

/**
 * 落印后这一行离开摞的时长(第四十六批第一节第 3 条):划线 80 → 左移 24px 并淡出 200(ease-out)→ 行高收起 160,共 440。
 * 印在判栏里落下的同一刻开始划线(第 5 条)。三段的时长写在 desk.module.css 的 `.row[data-leaving]`,改一处要改两处。
 */
export const SEAL_LEAVE_MS = 440;
/** 减少动态时:不移动,划线后 120ms 淡出,行高立即收起。 */
export const SEAL_LEAVE_REDUCED_MS = 120;
/** 选中后多久预取下一件的卷宗(fe-ia §6 / fe-perf):按住 J 一路扫过时不为每一件都发。 */
export const PREFETCH_DELAY_MS = 150;

type DeskSeal = DeskVerdictDraft & { id: string; name: string; caseNumber: string; civilization: string };

type T = (key: string, vars?: Record<string, string>) => string;

/** 结案被拒的那一句:与审判台同一组分类(`concludeRefusalOf`),认领一族的码走同一张译文表。 */
function concludeFailure(t: T, e: unknown): string {
  const r = concludeRefusalOf(e);
  if (r?.kind === "weighing") return t(`judgment.weighing.errors.${r.code}`);
  if (r?.kind === "fail_reason") return t(`judgment.fail_reason_errors.${r.code}`);
  if (r?.kind === "plan") return t(`sentence_plan.errors.${r.code}`);
  return claimRefusalMessage(e, t);
}

const orEmpty = (s: string | null | undefined) => s ?? "";
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

export function CaseDesk() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const canClaim = hasPermission("judgment.execute");
  const [source, setSource] = useState<JudgmentQueueSource | "all">("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  // 窄屏「点开一件」是一次导航(fe-mobile 3.2):`?case=<id>` 进历史,系统返回 / 边缘右滑回到摞,滚动位置由浏览器还原。
  // 所以「开着」由网址推出,不是 state;桌面不写网址(选中不进历史),带着 `?case=` 打开时照它选中。
  const pathname = usePathname();
  const caseParam = useSearchParams()?.get("case") ?? null;
  const phoneOpen = caseParam !== null;
  /** 这一件是本页 push 进历史的:「‹ 案卷台」就退一步,与系统返回同一个结果;直接打开的链接没有这一步,换成 replace。 */
  const pushedCase = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const chipsRef = useOverflowEnd<HTMLDivElement>();

  // 换来源时留着上一屏(`keepPreviousData`):概览与 chip 用的是不筛的数,不该在重取时闪空。
  const desk = useQuery({
    queryKey: judgmentKeys.desk(source === "all" ? undefined : source),
    queryFn: async () => (await dossiersApi.desk(source === "all" ? undefined : source)).data,
    placeholderData: keepPreviousData,
  });
  const counts = desk.data?.counts ?? null;
  const monthPct = desk.data?.month_done_pct ?? null;

  // 落了印的(撤回窗口里、请求在路上、已结而摞还没重取):不在摞上;正在滑出的那一行还画着(`leaving`)。
  const [gone, setGone] = useState<readonly string[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const groups = DESK_GROUPS.map((group) => {
    const g = desk.data?.groups.find((x) => x.group === group);
    const rows = g?.rows ?? [];
    const onDesk = (r: (typeof rows)[number]) => matchesSearch(r, query) && (!gone.includes(r.id) || r.id === leaving);
    return { group, total: g?.total ?? 0, rows: rows.filter(onDesk) };
  });
  const flat = groups.flatMap((g) => g.rows.map((row) => ({ row, group: g.group })));
  const ids = flat.map((f) => f.row.id);
  const chosen = caseParam ?? picked;
  const currentId = chosen && ids.includes(chosen) ? chosen : (ids[0] ?? null);
  const current = flat.find((f) => f.row.id === currentId) ?? null;
  const position = current ? { n: ids.indexOf(current.row.id) + 1, total: ids.length } : null;

  const loading = desk.isPending;
  const failed = desk.isError;

  // 换一件时卷宗淡入并上移 8px(与换页同一条「page-enter」:240ms 进场曲线)。不重新挂载 OpenCase,
  // 所以页签与滚动之外的本地状态不丢;减少动态效果时不播(全站的 1ms 规则管不到 Web Animations)。
  const caseRef = useRef<HTMLElement>(null);
  const shownId = current?.row.id ?? null;
  const firstShown = useRef(true);
  useEffect(() => {
    if (!shownId) return;
    if (firstShown.current) {
      firstShown.current = false;
      return;
    }
    const el = caseRef.current;
    if (!el?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.scrollTop = 0;
    el.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }, [shownId]);

  const caseHref = (id: string) => `${pathname}?case=${encodeURIComponent(id)}`;
  const select = (id: string | null) => {
    if (!id) return;
    setPicked(id);
    // 开着的一件换成下一件:换掉网址里的那一件,不多压一层历史。
    if (caseParam !== null) router.replace(caseHref(id), { scroll: false });
    rowRefs.current.get(id)?.scrollIntoView?.({ block: "nearest" });
  };
  const open = (id: string | null) => {
    if (id) router.push(`/judgment/${id}`);
  };

  const move = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "claim" | "release" }) => (kind === "claim" ? judgmentApi.claim(id) : judgmentApi.release(id)),
    // 认领被拒(别人先认领、候审中……)说出原因,与审判队列同一份文案;放回失败只说没能放回。
    onError: (e: unknown, { kind }) => showToast(kind === "claim" ? claimRefusalMessage(e, t) : t("officer_app.desk.release_failed"), "error"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: judgmentKeys.all }),
  });
  const claimable = !!current && canClaim && current.group === "unclaimed" && !heldBeforeClaim(current.row);
  const releasable = !!current && canClaim && current.group === "mine";

  // ── 就地判 ─────────────────────────────────────────────────────────────
  const [stamp, setStamp] = useState(0);
  /** 撤回回来的那一件:判栏带着当时的裁决与判词重新打开。 */
  const [restored, setRestored] = useState<DeskSeal | null>(null);
  /** 偏好「落印前先确认」打开时,等回读层答复的那一印。 */
  const [asking, setAsking] = useState<DeskSeal | null>(null);
  const [sealNote, setSealNote] = useState("");
  const currentRef = useRef(currentId);
  useEffect(() => {
    currentRef.current = currentId;
  });

  const sendSeal = (v: DeskSeal) =>
    judgmentApi.conclude(v.id, { verdict: v.verdict, notes: v.notes }).then(
      () => void queryClient.invalidateQueries({ queryKey: judgmentKeys.all }),
      (e: unknown) => {
        // 没落下(或说不清):这一件回到摞上,说清是哪一件、为什么。
        setGone((prev) => prev.filter((x) => x !== v.id));
        showToast(`${t("caseDesk.verdict.commit_error", { name: v.name })} ${concludeFailure(t, e)}`, "error");
      },
    );
  // W 不勾 = 不说(`create_workflow` 不带):原审由服务端按全部站生成审批流,与快审同一条(useJudgmentQueue 的 send)。
  const sealWindow = useStagedCommit<DeskSeal>((v) => void sendSeal(v));

  /** 这一行划线滑出,选中落到它后面那一件(没有就前一件)。 */
  const leave = (v: DeskSeal) => {
    const rest = ids.filter((x) => x !== v.id);
    const next = rest[Math.min(Math.max(ids.indexOf(v.id), 0), rest.length - 1)] ?? null;
    const nextName = flat.find((f) => f.row.id === next)?.row.soul_name ?? "";
    setStamp((n) => n + 1);
    setGone((prev) => (prev.includes(v.id) ? prev : [...prev, v.id]));
    setLeaving(v.id);
    setSealNote(next ? t("caseDesk.verdict.announce", { name: v.name, next: nextName }) : t("caseDesk.verdict.announce_last", { name: v.name }));
    window.setTimeout(
      () => {
        setLeaving((x) => (x === v.id ? null : x));
        if (currentRef.current === v.id && next) select(next);
      },
      reducedMotion() ? SEAL_LEAVE_REDUCED_MS : SEAL_LEAVE_MS,
    );
  };

  const seal = (d: DeskVerdictDraft) => {
    if (!current || gone.includes(current.row.id)) return;
    const { row } = current;
    const v: DeskSeal = { ...d, id: row.id, name: orEmpty(row.soul_name), caseNumber: orEmpty(row.case_number), civilization: orEmpty(row.civilization) };
    setRestored(null);
    if (sealReadbackEnabled()) {
      setAsking(v);
      return;
    }
    sealWindow.stage(v);
    leave(v);
  };
  /** 回读层里按了「落印」:当场发,没有撤回窗口。 */
  const confirmAsked = () => {
    const v = asking;
    setAsking(null);
    if (!v) return;
    void sendSeal(v);
    leave(v);
  };
  const undo = () => {
    const v = sealWindow.undo();
    if (!v) return;
    setGone((prev) => prev.filter((x) => x !== v.id));
    setLeaving(null);
    setRestored(v);
    setSealNote(t("caseDesk.verdict.undone", { name: v.name }));
    select(v.id);
  };

  // 窗口里关标签页,这一印就没发出去:先问(站内离开会把它发出去,见 `useStagedCommit`)。与快审同一条。
  useEffect(() => {
    if (!sealWindow.staged) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [sealWindow.staged]);

  // 选中一件 150ms 后预取下一件的卷宗(判栏与 OpenCase 读同一把键);已在缓存里且新鲜的不再发。
  const nextId = step(ids, currentId, 1);
  useEffect(() => {
    if (!nextId || nextId === currentId) return;
    const handle = window.setTimeout(() => {
      void queryClient.prefetchQuery({ queryKey: judgmentKeys.dossier(nextId), queryFn: async () => (await dossiersApi.get(nextId)).data, staleTime: 30_000 });
    }, PREFETCH_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [nextId, currentId, queryClient]);

  useShortcutHelp(SHORTCUTS);
  useHotkeys({
    j: () => select(step(ids, currentId, 1)),
    k: () => select(step(ids, currentId, -1)),
    c: () => {
      if (current && claimable && !move.isPending) move.mutate({ id: current.row.id, kind: "claim" });
    },
    ...(sealWindow.staged ? { u: undo, "mod+z": undo } : {}),
    "/": () => searchRef.current?.focus(),
  }, asking === null);
  // ↵ 不走 useHotkeys:它对所有按钮都会 preventDefault,而焦点在 chip、链接上时 ↵ 应当照常按下那个控件。
  // 只在焦点在页面本身或摞上的一行时打开卷宗。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || isTypingTarget(e.target)) return;
      const el = e.target as HTMLElement | null;
      const onPage = !el || el === document.body || el.id === "main" || el.dataset?.deskRow !== undefined;
      if (!onPage || !currentId) return;
      e.preventDefault();
      open(currentId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const overview = overviewParts(t, onDeskCount(counts), counts?.overdue ?? null, monthPct);
  const chips = sourceChips(t, counts);
  const elsewhere = chips.flatMap((c) => (c.kind === "link" ? [c] : []));
  const day = (iso: string) => formatIsoDay(iso, locale);
  const announce = current && position ? `${t("officer_app.desk.position", { n: String(position.n), total: String(position.total) })} · ${current.row.soul_name}` : "";

  return (
    <div className={s.desk} data-open={phoneOpen && current ? "" : undefined} data-testid="case-desk">
      <section className={s.stack} aria-labelledby="desk-title">
        <div className={s.stackHead}>
          {/* 栏头,不是标题:这一页的 <h1> 是右边摊开那一份的人名(PageHead)。 */}
          <p id="desk-title" className={s.stackTitle}>
            {t("officer_app.desk.title")}
          </p>
          {overview.length ? (
            <p className={s.overview} data-testid="desk-overview">
              {overview.map((p, i) => (
                <span key={p.text} className={p.neg ? s.neg : undefined}>
                  {i ? ` · ${p.text}` : p.text}
                </span>
              ))}
            </p>
          ) : null}
          {/* 来源一行,不折行(用户 2026-11-14:七个 chip 在 360 栏里折成三行)。就地筛的 chip(全部、本台各来源)一行横滑;
              带 › 的去别的页,桌面收进「更多来源 ▾」(同一份数与网址),393 照旧排在同一行横滑里 —— 两种都在 DOM 里,CSS 按宽度藏一种。 */}
          {chips.length > 1 ? (
            <div className={s.sources}>
              <div ref={chipsRef} className={s.chips} data-testid="desk-sources" role="group" aria-label={t("caseDesk.sources_label")}>
                {chips.map((c) =>
                  c.kind === "filter" ? (
                    <button
                      key={c.key}
                      type="button"
                      className={s.chip}
                      aria-pressed={source === c.key}
                      onClick={() => setSource(c.key === source ? "all" : c.key)}
                      data-testid={`desk-source-${c.key}`}
                    >
                      {c.label}
                      <span className={s.chipCount}>{c.count}</span>
                    </button>
                  ) : (
                    <Link key={c.key} href={c.href} className={`${s.chip} ${s.linkChip}`} data-testid={`desk-source-${c.key}`}>
                      {c.label}
                      <span className={s.chipCount}>{c.count}</span>
                      <span aria-hidden="true">›</span>
                    </Link>
                  ),
                )}
              </div>
              {elsewhere.length ? (
                <div className={s.more}>
                  <ActionsMenu
                    menuLabel={t("caseDesk.more_sources")}
                    trigger={{ label: `${t("caseDesk.more_sources")} ▾`, className: s.chip, testId: "desk-sources-more" }}
                    items={elsewhere.map((c) => ({
                      key: c.key,
                      label: (
                        <>
                          <span>{c.label}</span>
                          <span className={`${s.chipCount} ml-auto pl-4`}>{c.count}</span>
                          <span aria-hidden="true" className="pl-2">›</span>
                        </>
                      ),
                      onSelect: () => router.push(c.href),
                    }))}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={s.searchRow}>
            <input
              ref={searchRef}
              type="search"
              className={s.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("caseDesk.search_placeholder")}
              aria-label={t("caseDesk.search_placeholder")}
              aria-keyshortcuts="/"
              data-testid="desk-search"
            />
            <span className={s.kbd} aria-hidden="true">
              /
            </span>
            {/* 分诊不是来源:是同一条队列的一件一件看(`/judgment/queue`)。 */}
            <Link href="/judgment/queue" className={`${s.triage} ${s.hideNarrow}`}>
              {`${t("caseDesk.triage")} ›`}
            </Link>
          </div>
        </div>

        {failed && !desk.data ? (
          <p className={s.note} role="alert">
            {t("caseDesk.load_failed")}{" "}
            <Button size="sm" onClick={() => void desk.refetch()}>
              {t("common.retry")}
            </Button>
          </p>
        ) : loading && flat.length === 0 ? (
          <p className={s.note}>{t("common.loading")}</p>
        ) : flat.length === 0 ? (
          <div data-testid="desk-empty">
            {query ? (
              <p className={s.note}>{t("caseDesk.search_none")}</p>
            ) : (
              <EmptyState title={t("officer_app.desk.empty_title")} reason={t("officer_app.desk.empty_body")} />
            )}
          </div>
        ) : (
          groups.map(({ group, total, rows }) =>
            rows.length === 0 ? null : (
              <section key={group} data-testid={`desk-group-${group}`} aria-labelledby={`desk-group-${group}`}>
                <h2 id={`desk-group-${group}`} data-h2-role="column" className={s.groupHead}>
                  <span>{t(`officer_app.desk.groups.${group}`)}</span>
                  <span className={s.groupCount}>{String(query ? rows.length : total)}</span>
                </h2>
                <ul className={s.rows}>
                  {rows.map((row) => {
                    const tag = deskTag(t, row, group);
                    const line = [sourceLabel(t, row), courtLabel(t, row.court, locale), ...rowNotes(t, row, group, tag.deadline, day)].filter(Boolean).join(" · ");
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) rowRefs.current.set(row.id, el);
                            else rowRefs.current.delete(row.id);
                          }}
                          className={s.row}
                          aria-current={row.id === currentId ? "true" : undefined}
                          data-desk-row=""
                          data-leaving={row.id === leaving ? "" : undefined}
                          data-testid={`desk-row-${row.id}`}
                          onClick={() => {
                            select(row.id);
                            if (window.matchMedia?.("(max-width: 768px)")?.matches) {
                              pushedCase.current = true;
                              router.push(caseHref(row.id));
                            }
                          }}
                        >
                          <span className={s.rowName}>{row.soul_name}</span>
                          <span className={s.rowRight}>
                            <Badge tone={tag.tone} glyph={tag.glyph || undefined}>
                              {tag.text}
                            </Badge>
                            <span className={s.caseNo}>
                              <CaseNumber value={row.case_number} plain />
                            </span>
                          </span>
                          <span className={s.rowLine} title={line}>
                            {line}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
          )
        )}
      </section>

      <section ref={caseRef} className={s.case} aria-label={t("caseDesk.open_case")} data-testid="desk-case">
        {current && position ? (
          <OpenCase
            row={current.row}
            group={current.group}
            position={position}
            onBack={() => {
              if (pushedCase.current) {
                pushedCase.current = false;
                router.back();
              } else router.replace(pathname, { scroll: false });
            }}
            onNext={() => select(step(ids, currentId, 1))}
            onOpen={() => open(current.row.id)}
            claim={claimable ? { busy: move.isPending, run: () => move.mutate({ id: current.row.id, kind: "claim" }) } : null}
            release={releasable ? { busy: move.isPending, run: () => move.mutate({ id: current.row.id, kind: "release" }) } : null}
          />
        ) : (
          <p className={s.empty}>{t("caseDesk.pick")}</p>
        )}
      </section>

      {/* 判栏(第四十六批第一节):最右一栏,底 surface-1,左边一条 1px 线通到底,不加阴影。栏头一行「判栏 · 1–4 · ⌘⏎」。
          <1280 收成卷宗下面的判决条(1–4 与落印一行);393 不画(窄屏照旧打开卷宗)。 */}
      <aside className={s.side} aria-label={t("caseDesk.verdict.rail")} data-testid="desk-side">
        <h2 id="desk-rail-head" data-h2-role="column" className={s.railHead}>
          <span>{t("caseDesk.verdict.rail")}</span>
          <span className={s.railKeys} aria-hidden="true">
            1–4 · ⌘⏎
          </span>
        </h2>
        {current ? (
          <VerdictRail
            key={current.row.id}
            row={current.row}
            group={current.group}
            claim={claimable ? { busy: move.isPending, run: () => move.mutate({ id: current.row.id, kind: "claim" }) } : null}
            sealed={gone.includes(current.row.id)}
            stampKey={stamp}
            draft={restored?.id === current.row.id ? restored : null}
            paused={asking !== null}
            onSeal={seal}
            onOpen={() => open(current.row.id)}
          />
        ) : null}
        {/* 撤回条(第 4 条):判栏底部,盖住落印区,不用全局 toast。两行字 + 描边的「撤回 ⌘Z」;底边 2px、墨 60% 的线 5 秒线性缩完。
            悬停不暂停:到时提交是真的期限。 */}
        {sealWindow.staged ? (
          <div className={s.undo} data-testid="desk-undo">
            <span className={s.undoWhat}>
              {`${sealWindow.staged.name} · `}
              <DomainEnum namespace={verdictNamespace(t, sealWindow.staged.civilization, sealWindow.staged.verdict)} value={sealWindow.staged.verdict} />
            </span>
            <span className={s.undoNote}>{t("judgment.queue.sealed", { n: String(UNDO_MS / 1000) })}</span>
            <Button size="sm" variant="secondary" className={s.undoButton} onClick={undo} aria-keyshortcuts="Meta+Z Control+Z U" data-testid="desk-undo-button">
              {t("judgment.queue.undo")}
              <span className={s.kbd} aria-hidden="true">
                ⌘Z
              </span>
            </Button>
            <span key={sealWindow.staged.id} className={s.undoClock} style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden="true" />
          </div>
        ) : null}
      </aside>

      <SealReadbackDialog item={asking} onCancel={() => setAsking(null)} onConfirm={confirmAsked} />
      <p className="sr-only" aria-live="polite" data-testid="desk-seal-announce">
        {sealNote}
      </p>

      <p className="sr-only" aria-live="polite" data-testid="desk-announce">
        {announce}
      </p>
    </div>
  );
}
