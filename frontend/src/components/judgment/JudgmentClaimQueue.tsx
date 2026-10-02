"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import {
  judgmentApi,
  PAGE_SIZE,
  type Judgment,
  type JudgmentBatchOperation,
  type JudgmentQueueGroup,
} from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { CIVILIZATION_OPTIONS, TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import {
  useBatchJudgments,
  useClaimJudgment,
  useJudgmentCourts,
  useJudgmentQueueCounts,
  useReleaseJudgment,
} from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { Pagination } from "@/src/components/ui/Pagination";
import { DomainEnum, DomainNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { DeferDialog, ReassignDialog, claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { BATCH_BAR, ROW_HOVER, ROW_LINK, ROW_SELECTED } from "@/components/ui/data-table";
import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";
import { useHotkeys } from "@/src/lib/hotkeys";
import { verdictGlyph } from "@/src/lib/verdictGlyph";
import { ClaimAvatar } from "@/src/components/judgment/ClaimAvatar";
import { RowMark, ROW_MARK_ROW, isMinePending } from "@/src/components/judgment/RowMark";
import { MISSING_LABEL_KEY } from "@/src/lib/domainDisplay";

/**
 * 审判队列的「待审」一面(规范 v3 第 7 轮 `QueuePage`,落在规范 v1 第三类 A·02 的四组上):
 * 按「谁在处理」分四组 —— 我认领 / 待认领 / 他人认领 / 暂缓。组是服务端的 `?group=`,组头的数是
 * `queue-counts/`,两者用同一组 `court` / `civilization` / `search`,所以数与行出自同一个筛选。
 * 每组各自分页;排序默认等待最久在上(`ordering=created_at`),可切成最近入队。
 * 文明下拉:ADMIN 列全部文明,其余角色只列自己租户的文明。
 *
 * v3 的工具条:搜索 · 「全部案卷 / 我认领的」(后者只留「我认领」一组,列表 160ms 交叉淡化)·
 * 殿 / 文明 / 排序 · 右端「改派…」(勾选的,没勾选时焦点行)。
 *
 * 键盘(v3「审判队列七个动作」):↑↓(或 J / K)在行间移焦点 —— 焦点落在行里那条链接上,
 * 所以 Enter 就是链接自己的 Enter;X 勾选;C 认领焦点行,已是我认领的就取消认领;
 * S 把焦点行延后到本次会话末(只排到本组末尾、「延后」一格写「本次会话」,不写服务端 ——
 * 和分诊台的 S 同一个意思);R 先确认,再把本次会话延后的全部放回。打字时一概不接。
 *
 * 批量只做认领、改派、暂缓(brief §4.2:不做批量裁决)。`/judgment/batch/` 全有或全无、
 * 一次至多 100 件;被拒时整批回滚,拒绝码说是哪一件、为什么。
 *
 * v3 有、这里没有的列(后端没有这些字段,不编):案号 SL-…(只有 UUID,IDENTIFIER_POLICY 不印)。
 * 「功 / 过」分列读 `merit_score` / `demerit_score`(灵魂此刻的两本账,四个文明都有;VIEWER 拿不到,
 * 写「未记录」);「世次 / 种类」读 `cycle`(0 是第一世)与 `kind`。
 *
 * 尺寸照 v3(2026-10-01 拍板):行 `min-height: 64px`、表头 44、工具条控件 44、行尾「⋯」列 44。
 * 「⋯」菜单(v3 `.queue-row` 最后一格):认领 / 取消认领 / 延后 / 改派…,按权限出现 ——
 * 取消认领此前只有 C 键,这是它的鼠标路径。
 */

const GROUPS: readonly JudgmentQueueGroup[] = ["mine", "unclaimed", "others", "deferred"];
/** 排序:列表接口的 `ordering`(`JudgmentViewSet.ordering_fields`)。默认等待最久在上 —— 队列先进先出。 */
const ORDERINGS = ["created_at", "-created_at"] as const;
type QueueOrdering = (typeof ORDERINGS)[number];
const BATCH_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 300;
const DAY_MS = 86_400_000;
/** 等待超过这么多天的行,等待数改警示色(稿子里的 137 天 / 53 天)。 */
const LONG_WAIT_DAYS = 30;
/** 认领时间只要到分(v3 写「14:12」);年份与秒在这一格里是噪音。 */
const CLAIMED_AT_FORMAT: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" };
/** 「本次会话」延后:浏览器会话内有效,去审判台再回来还在;关掉标签页就没了。 */
const SESSION_DEFERRED_KEY = "soulledger-queue-session-deferred";

function readSessionDeferred(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_DEFERRED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const SELECT_CLASS =
  "h-(--control-h-sm) border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-2 text-sm text-[oklch(var(--color-ink))]";
/** 分段按钮(全部案卷 / 我认领的):当前一段 ink 框 + 600,不用文明色。 */
const SEGMENT = (on: boolean) =>
  `h-(--control-h-sm) border px-3 text-sm ${
    on
      ? "border-[oklch(var(--color-ink))] font-semibold text-[oklch(var(--color-ink))]"
      : "border-[oklch(var(--color-line))] text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
  }`;

export function JudgmentClaimQueue() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const canExecute = hasPermission("judgment.execute");
  const canAssign = hasPermission("judgment.assign");

  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [court, setCourt] = useState("");
  const [civilization, setCivilization] = useState("");
  const [ordering, setOrdering] = useState<QueueOrdering>("created_at");
  const [mineOnly, setMineOnly] = useState(false);
  const [pages, setPages] = useState<Record<JudgmentQueueGroup, number>>({ mine: 1, unclaimed: 1, others: 1, deferred: 1 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"defer" | "reassign" | "restore" | null>(null);
  /** 行内「⋯ → 改派…」作用的那一件;工具条与批量条的改派仍按勾选 / 焦点行。 */
  const [rowReassign, setRowReassign] = useState<string | null>(null);
  /** 已发出取消认领、服务端还没刷新到的 id:色标先退场(140ms),不等往返。 */
  const [releasing, setReleasing] = useState<ReadonlySet<string>>(new Set());
  // 服务端渲染时 `window` 不存在,读取在 try 里落成空表;这一页在权限门之后才挂,首帧就在浏览器里。
  const [sessionDeferred, setSessionDeferred] = useState<string[]>(readSessionDeferred);
  const [now] = useState(() => Date.now());
  const tableRef = useRef<HTMLTableElement>(null);

  const saveSessionDeferred = (next: string[]) => {
    setSessionDeferred(next);
    try {
      window.sessionStorage.setItem(SESSION_DEFERRED_KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式等:只在内存里延后,本页内照样有效。 */
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term.trim());
      setPages({ mine: 1, unclaimed: 1, others: 1, deferred: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const filters: Record<string, string> = {};
  if (search) filters.search = search;
  if (court) filters.court = court;
  if (civilization) filters.civilization = civilization;
  /* 文明的选项:ADMIN 看得到全部文明;其余角色只列自己租户的那一个(后端按租户收窄,
     列别的文明只会给出一个永远为空的选项)。 */
  const ownCivilization = user?.tenant?.code ? TENANT_CODE_TO_CIVILIZATION[user.tenant.code] : undefined;
  const civilizationOptions: readonly string[] = isAdmin ? CIVILIZATION_OPTIONS : ownCivilization ? [ownCivilization] : [];
  const resetPages = () => setPages({ mine: 1, unclaimed: 1, others: 1, deferred: 1 });

  const counts = useJudgmentQueueCounts(filters);
  const groupQueries = useQueries({
    queries: GROUPS.map((group) => {
      const params = { ...filters, group, page: String(pages[group]), ordering };
      return {
        queryKey: judgmentKeys.list(params),
        queryFn: async () => (await judgmentApi.list(params)).data,
        placeholderData: (previous: unknown) => previous as never,
      };
    }),
  });
  const shownGroups = GROUPS.filter((g) => !mineOnly || g === "mine");
  /** 本组本页的行;本次会话延后的排到本组末尾(稳定排序,其余次序不动)。 */
  const rowsOf = (group: JudgmentQueueGroup): Judgment[] => {
    const rows = groupQueries[GROUPS.indexOf(group)].data?.results ?? [];
    const later = (j: Judgment) => (sessionDeferred.includes(j.id) ? 1 : 0);
    return [...rows].sort((a, b) => later(a) - later(b));
  };
  const allRows = shownGroups.flatMap(rowsOf);
  const selectable = new Set(allRows.map((j) => j.id));
  const chosen = [...selected].filter((id) => selectable.has(id));
  /** 工具条「改派…」作用的案子:勾选的;没勾选时是焦点行。 */
  const reassignIds = rowReassign
    ? [rowReassign]
    : chosen.length > 0
      ? chosen.slice(0, BATCH_LIMIT)
      : focused && selectable.has(focused)
        ? [focused]
        : [];
  const closeDialog = () => {
    setDialog(null);
    setRowReassign(null);
  };

  /* 殿的选项:`/judgment/courts/` —— 调用者范围内的全部殿,各带未结案件数,不随当前筛选收窄。
     此前取自已加载的几页行,翻不到的殿就选不到。已选的那一个在名单到之前也留着。 */
  const courtOptions = useJudgmentCourts().data ?? [];
  const courts = courtOptions.some((c) => c.court === court) || !court
    ? courtOptions
    : [...courtOptions, { court, pending: undefined }];

  const claim = useClaimJudgment();
  const release = useReleaseJudgment();
  const batch = useBatchJudgments();

  const runBatch = (operation: JudgmentBatchOperation, extra: { to?: number; reason?: string } = {}) => {
    const ids = operation === "reassign" ? reassignIds : chosen.slice(0, BATCH_LIMIT);
    batch.mutate(
      { operation, ids, ...extra },
      {
        onSuccess: () => {
          showToast(t(`judgment.claim.done_${operation}`, { n: String(ids.length) }), "success");
          if (!rowReassign) setSelected(new Set());
          closeDialog();
        },
        onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
      }
    );
  };

  const setReleasingId = (id: string, on: boolean) =>
    setReleasing((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const claimOne = (id: string) =>
    claim.mutate(id, {
      onSuccess: () => {
        setReleasingId(id, false);
        showToast(t("judgment.claim.done_claim", { n: "1" }), "success");
      },
      onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
    });

  const releaseOne = (id: string) => {
    setReleasingId(id, true);
    release.mutate(id, {
      onSuccess: () => showToast(t("judgment.claim.done_release"), "success"),
      onError: (err) => {
        setReleasingId(id, false);
        showToast(claimRefusalMessage(err, t), "error");
      },
    });
  };

  /** S 与「⋯ → 延后」:本次会话延后,只排到本组末尾,不写服务端。 */
  const deferForSession = (id: string) => {
    if (sessionDeferred.includes(id)) return;
    saveSessionDeferred([...sessionDeferred, id]);
    showToast(t("judgment.claim.done_session_defer"), "success");
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** ↑↓ / J K:把 DOM 焦点移到相邻行的链接上。没有焦点行时,向下落到第一行、向上落到最后一行。 */
  const move = (step: 1 | -1) => {
    if (allRows.length === 0) return;
    const at = focused ? allRows.findIndex((j) => j.id === focused) : -1;
    const next = at === -1 ? (step === 1 ? 0 : allRows.length - 1) : Math.min(allRows.length - 1, Math.max(0, at + step));
    const id = allRows[next].id;
    tableRef.current?.querySelector<HTMLAnchorElement>(`[data-row-link="${id}"]`)?.focus();
    setFocused(id);
  };

  const focusedRow = focused ? allRows.find((j) => j.id === focused) : undefined;

  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    x: () => {
      if (focused && canExecute && selectable.has(focused)) toggle(focused);
    },
    c: () => {
      if (!focusedRow || !canExecute || claim.isPending || release.isPending) return;
      if (focusedRow.claimed_by == null) claimOne(focusedRow.id);
      else if (focusedRow.claimed_by === user?.id) releaseOne(focusedRow.id);
    },
    s: () => {
      if (focusedRow) deferForSession(focusedRow.id);
    },
    r: () => {
      if (sessionDeferred.length > 0) setDialog("restore");
    },
  });

  const waitingDays = (j: Judgment) => Math.max(0, Math.floor((now - new Date(j.created_at).getTime()) / DAY_MS));
  const colSpan = canExecute ? 11 : 10;

  return (
    <div>
      {/* ── 工具条:搜索 · 全部案卷 / 我认领的 · 殿 · 文明 · 排序 · 改派 ───────────── */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <label className="min-w-0 basis-full sm:basis-auto sm:w-70">
          <span className="sr-only">{t("judgment.claim.search")}</span>
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("judgment.claim.search")}
            className="w-full h-(--control-h-sm) border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-2 text-sm text-[oklch(var(--color-ink))] placeholder:text-[oklch(var(--color-ink-subtle))]"
          />
        </label>
        <div className="flex" data-testid="queue-scope">
          {([false, true] as const).map((mine) => (
            <button
              key={String(mine)}
              type="button"
              aria-pressed={mineOnly === mine}
              onClick={() => {
                setMineOnly(mine);
                setFocused(null);
              }}
              className={`${SEGMENT(mineOnly === mine)} ${mine ? "-ml-px" : ""}`}
            >
              {t(mine ? "judgment.claim.filter_mine" : "judgment.claim.filter_all")}
            </button>
          ))}
        </div>
        <label>
          <span className="sr-only">{t("judgment.court")}</span>
          <select
            value={court}
            onChange={(e) => {
              setCourt(e.target.value);
              resetPages();
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t("judgment.claim.court_all")}</option>
            {courts.map((c) => (
              <option key={c.court} value={c.court}>
                {c.pending === undefined ? c.court : `${c.court} · ${c.pending}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("judgment.civilization")}</span>
          <select
            value={civilization}
            onChange={(e) => {
              setCivilization(e.target.value);
              resetPages();
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t("judgment.claim.civilization_all")}</option>
            {civilizationOptions.map((c) => (
              <option key={c} value={c}>
                {t(`souls.civilizations.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("judgment.claim.sort")}</span>
          <select
            value={ordering}
            onChange={(e) => {
              setOrdering(e.target.value as QueueOrdering);
              resetPages();
            }}
            className={SELECT_CLASS}
          >
            {ORDERINGS.map((o) => (
              <option key={o} value={o}>
                {t(`judgment.claim.sort_${o === "created_at" ? "oldest" : "newest"}`)}
              </option>
            ))}
          </select>
        </label>
        {canAssign && (
          <Button
            type="button"
            size="md"
            variant="secondary"
            className="sm:ml-auto"
            disabled={reassignIds.length === 0}
            onClick={() => setDialog("reassign")}
          >
            {t("judgment.claim.reassign")}
          </Button>
        )}
      </div>

      {/* ── 批量条:只在有勾选时出现,吸在工具条下沿;出现时 translateY(8→0)+淡入 160ms。
             认领 / 改派… / 暂缓,不做批量裁决。 ── */}
      {canExecute && chosen.length > 0 && (
        <div
          data-testid="batch-bar"
          className={`sticky top-(--below-band) z-filters flex flex-wrap items-center gap-2 px-3 py-2 mb-2 border border-[oklch(var(--color-block))] ${BATCH_BAR} text-sm transition-[opacity,translate] duration-fast ease-enter starting:translate-y-2 starting:opacity-0`}
        >
          <span className="mr-auto font-mono text-xs tabular-nums">{t("judgment.claim.selected", { n: String(chosen.length) })}</span>
          <Button type="button" size="sm" variant="inverse" loading={batch.isPending} onClick={() => runBatch("claim")}>
            {t("judgment.claim.claim")}
          </Button>
          {canAssign && (
            <Button type="button" size="sm" variant="inverse" onClick={() => setDialog("reassign")}>
              {t("judgment.claim.reassign")}
            </Button>
          )}
          <Button type="button" size="sm" variant="inverse" onClick={() => setDialog("defer")}>
            {t("judgment.claim.defer")}
          </Button>
          <Button type="button" size="sm" variant="inverse" onClick={() => setSelected(new Set())}>
            {t("judgment.claim.clear_selection")}
          </Button>
          {chosen.length > BATCH_LIMIT && (
            // 批量条是 ink 反相底:警示色字在上面只有 2.65 / 3.14:1(深 / 浅),不达标。
            // 2026-10-01 拍板改用条本身的字色,意思交给字形 ◐(本仓的警示档字形,见
            // StatusBadge)+ 文字 —— 规范一贯的「不靠颜色单独传达」。
            <span className="text-xs">
              <span aria-hidden="true">◐ </span>
              {t("judgment.claim.batch_limit", { n: String(BATCH_LIMIT) })}
            </span>
          )}
        </div>
      )}

      {/* 「我认领的」切换:整张表换 key 重挂,160ms 交叉淡化;不让每行依次入场。 */}
      <table
        key={mineOnly ? "mine" : "all"}
        ref={tableRef}
        className="w-full text-sm border-t border-[oklch(var(--color-block))] transition-opacity duration-fast ease-enter starting:opacity-0"
        aria-label={t("judgment.pending")}
      >
        <thead>
          {/* 补足 B9 表头:11 等宽 ink3、下沿 2px ink;高 44(v3 `.queue-head`)。 */}
          <tr className="h-(--control-h-sm) font-mono text-2xs text-[oklch(var(--color-ink-subtle))] border-b-2 border-[oklch(var(--color-ink))]">
            {canExecute && <th scope="col" className="w-6"><span className="sr-only">{t("judgment.claim.select")}</span></th>}
            <th scope="col" className="px-2 py-1 text-left font-normal">{t("judgment.soul_name")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal max-md:hidden">{t("judgment.court")}</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">{t("judgment.claim.col_merit_demerit")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal max-lg:hidden">{t("judgment.claim.col_draft")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal">{t("judgment.claim.claimant")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal max-md:hidden">{t("judgment.claim.col_deferred")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal max-xl:hidden">{t("judgment.claim.col_cycle_kind")}</th>
            <th scope="col" className="px-2 py-1 text-right font-normal max-xl:hidden">{t("judgment.detail.evidence")}</th>
            <th scope="col" className="px-2 py-1 text-right font-normal max-sm:hidden">{t("judgment.waiting")}</th>
            <th scope="col" className="w-11"><span className="sr-only">{t("common.row_actions")}</span></th>
          </tr>
        </thead>
        {shownGroups.map((group) => {
          const q = groupQueries[GROUPS.indexOf(group)];
          const rows = rowsOf(group);
          const count = counts.data?.[group];
          const total = q.data?.count ?? 0;
          return (
            <tbody key={group} data-testid={`queue-group-${group}`}>
              {/* 分组头 GroupHeader:组名 · 服务端计数 · 一句提示。 */}
              <tr className="border-b border-[oklch(var(--color-line))]">
                <th scope="rowgroup" colSpan={colSpan} className="px-2 pt-4 pb-1 text-left font-normal">
                  <span className="text-xs font-semibold text-[oklch(var(--color-ink))]">{t(`judgment.claim.groups.${group}`)}</span>
                  <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]" data-testid={`group-count-${group}`}>
                    {" · "}
                    {count ?? "…"}
                  </span>
                  {/* 「等待最久在上」只在它为真时说:换成「最近入队」就不说了。 */}
                  {((group === "unclaimed" && ordering === "created_at") || group === "others") && (
                    <span className="ml-3 text-xs text-[oklch(var(--color-ink-subtle))]">{t(`judgment.claim.hints.${group}`)}</span>
                  )}
                </th>
              </tr>
              {q.isError ? (
                <tr>
                  <td colSpan={colSpan}>
                    <QueryError onRetry={() => q.refetch()} />
                  </td>
                </tr>
              ) : q.isLoading ? (
                <tr aria-busy="true">
                  <td colSpan={colSpan} className="h-10 px-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="h-10 px-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.claim.group_empty")}</td>
                </tr>
              ) : (
                rows.map((j) => {
                  const isSel = selected.has(j.id);
                  const isFocus = focused === j.id;
                  const days = waitingDays(j);
                  const mine = j.claimed_by != null && j.claimed_by === user?.id;
                  const marked = isMinePending(j, user?.id) && !releasing.has(j.id);
                  const laterThisSession = sessionDeferred.includes(j.id);
                  return (
                    <tr
                      key={j.id}
                      data-testid="queue-row"
                      data-focused={isFocus ? "true" : undefined}
                      data-session-deferred={laterThisSession ? "true" : undefined}
                      onFocus={() => setFocused(j.id)}
                      /* 选中 / 焦点 = 7% ink 底,没有行首竖条;竖条只表示「待我处理」(RowMark)。
                         延后的行(B12):不加色标、不变灰,只把透明度降到 0.56;放回后色标重新出现。 */
                      className={`relative h-(--table-row-h) border-b border-[oklch(var(--color-line))] ${
                        isSel || isFocus ? ROW_SELECTED : `${ROW_HOVER} ${marked ? ROW_MARK_ROW : ""}`
                      } ${group === "deferred" ? "opacity-[0.56]" : ""}`}
                    >
                      {canExecute && (
                        <td className="w-6 px-1 relative z-10">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(j.id)}
                            aria-label={t("judgment.claim.select_row", { name: j.soul_name || t(MISSING_LABEL_KEY.unrecorded) })}
                            className="h-3.5 w-3.5 max-sm:h-5 max-sm:w-5 accent-[oklch(var(--color-accent))]"
                          />
                        </td>
                      )}
                      <td className="px-2 max-w-56">
                        {/* 一直挂着、由 on 切换:取消认领时竖条反着退场(scaleY 1→0,140ms)。 */}
                        <RowMark on={marked} />
                        <span className="block truncate text-sm font-medium text-[oklch(var(--color-ink))]" title={j.soul_name || undefined}>
                          <Link href={`/judgment/${j.id}`} data-row-link={j.id} className={ROW_LINK}>
                            {j.soul_name ? j.soul_name : <MissingValue kind="unrecorded" reason="soul_name 未随判决返回" />}
                          </Link>
                        </span>
                        <span className="block whitespace-nowrap text-2xs text-[oklch(var(--color-ink-subtle))]">
                          <DomainEnum namespace="souls.civilizations" value={j.civilization} />
                        </span>
                      </td>
                      <td className="px-2 text-xs text-[oklch(var(--color-ink-muted))] whitespace-nowrap max-w-48 truncate max-md:hidden" title={[j.court, j.judge_name].filter(Boolean).join(" · ") || undefined}>
                        {[j.court, j.judge_name].filter(Boolean).join(" · ") || <MissingValue kind="unrecorded" />}
                      </td>
                      <td className="px-2 text-right text-xs whitespace-nowrap" data-testid="merit-demerit-cell">
                        {/* 功 / 过分开写(v3 `<b>功</b> / 过`),不是净值;VIEWER 两个字段都不在,写「未记录」。 */}
                        <DomainNumber value={j.merit_score} className="font-semibold text-[oklch(var(--color-ink))]" />
                        <span className="text-[oklch(var(--color-ink-muted))]"> / </span>
                        <DomainNumber value={j.demerit_score} className="text-[oklch(var(--color-ink-muted))]" />
                      </td>
                      <td className="px-2 text-xs whitespace-nowrap max-lg:hidden" data-testid="draft-cell">
                        {/* 草拟判决:字形 + 文字,不单靠颜色。没拟过的写「未拟」,不是「未记录」。 */}
                        {j.draft_verdict ? (
                          <span title={j.draft_verdict} className="text-[oklch(var(--color-ink))]">
                            <span aria-hidden="true">{verdictGlyph(j.draft_verdict)} </span>
                            {t(`judgment.verdicts.${j.draft_verdict.toLowerCase()}`)}
                          </span>
                        ) : (
                          <span className="text-[oklch(var(--color-ink-subtle))]">{t("judgment.claim.draft_none")}</span>
                        )}
                      </td>
                      <td className="px-2 relative z-10 whitespace-nowrap">
                        {j.claimed_by != null ? (
                          <span className="flex items-center gap-2">
                            <ClaimAvatar name={j.claimed_by_name ?? ""} mine={mine} />
                            <span className="min-w-0 max-md:hidden">
                              <span className="block max-w-28 truncate text-xs text-[oklch(var(--color-ink))]" title={j.claimed_by_name || undefined}>
                                {mine ? t("judgment.claim.reassign_you") : j.claimed_by_name || <MissingValue kind="unrecorded" />}
                              </span>
                              {j.claimed_at && (
                                <span className="block font-mono text-2xs tabular-nums text-[oklch(var(--color-ink-subtle))]">
                                  {formatDateTime(j.claimed_at, CLAIMED_AT_FORMAT)}
                                </span>
                              )}
                            </span>
                          </span>
                        ) : canExecute && group !== "deferred" ? (
                          /* B9 行内动作:1px ink3 框、11 字,不是下划线链接。 */
                          <button
                            type="button"
                            onClick={() => claimOne(j.id)}
                            className="inline-flex h-(--control-h-sm) items-center px-3 border border-[oklch(var(--color-line-strong))] text-2xs text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
                          >
                            {t("judgment.claim.claim")}
                          </button>
                        ) : null}
                      </td>
                      <td
                        className="px-2 text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))] max-md:hidden"
                        title={group === "deferred" && j.defer_reason ? j.defer_reason : undefined}
                        data-testid="deferred-cell"
                      >
                        {/* 没延后的行这一格空着:「没延后」是常态,不是缺了一条记录。 */}
                        {group === "deferred"
                          ? t("judgment.claim.groups.deferred")
                          : laterThisSession
                            ? t("judgment.claim.deferred_session")
                            : null}
                      </td>
                      <td className="px-2 text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))] max-xl:hidden" data-testid="cycle-kind-cell">
                        {/* 世次在上(cycle 0 = 第 1 世),种类小字在下(v3 `第四世<small>初审</small>`)。 */}
                        <span className="block text-[oklch(var(--color-ink))]">
                          {j.cycle == null ? <MissingValue kind="unrecorded" /> : t("souls.detail.life_number", { n: String(j.cycle + 1) })}
                        </span>
                        <span className="block text-2xs">
                          <DomainEnum namespace="judgment.claim.kinds" value={j.kind} />
                        </span>
                      </td>
                      <td className="px-2 text-right text-xs max-xl:hidden">
                        <DomainNumber value={j.evidence_count} />
                      </td>
                      <td
                        className={`px-2 text-right font-mono text-xs tabular-nums whitespace-nowrap max-sm:hidden ${
                          days > LONG_WAIT_DAYS ? "text-[oklch(var(--color-warning))]" : "text-[oklch(var(--color-ink-muted))]"
                        }`}
                      >
                        {t("judgment.waiting_days", { n: String(days) })}
                      </td>
                      <td className="w-11 relative z-10 text-right">
                        <ActionsMenu
                          menuLabel={`${t("common.row_actions")} · ${j.soul_name || t(MISSING_LABEL_KEY.unrecorded)}`}
                          items={[
                            ...(canExecute && j.claimed_by == null && group !== "deferred"
                              ? [{ key: "claim", label: t("judgment.claim.claim"), onSelect: () => claimOne(j.id), disabled: claim.isPending }]
                              : []),
                            ...(canExecute && mine
                              ? [{ key: "release", label: t("judgment.claim.release"), onSelect: () => releaseOne(j.id), disabled: release.isPending }]
                              : []),
                            ...(group !== "deferred" && !laterThisSession
                              ? [{ key: "defer", label: t("judgment.queue.defer"), onSelect: () => deferForSession(j.id) }]
                              : []),
                            ...(canAssign
                              ? [{ key: "reassign", label: t("judgment.claim.reassign"), onSelect: () => { setRowReassign(j.id); setDialog("reassign"); } }]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
              {total > PAGE_SIZE && (
                <tr>
                  <td colSpan={colSpan}>
                    <Pagination
                      page={pages[group]}
                      totalPages={Math.ceil(total / PAGE_SIZE)}
                      count={total}
                      onPageChange={(p) => setPages((prev) => ({ ...prev, [group]: p }))}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>

      {sessionDeferred.length > 0 && (
        <div data-testid="session-deferred" className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[oklch(var(--color-ink-muted))]">
          <span>{t("judgment.queue.session_deferred", { n: String(sessionDeferred.length) })}</span>
          <Button type="button" size="sm" variant="secondary" aria-keyshortcuts="R" onClick={() => setDialog("restore")}>
            {t("judgment.queue.restore_all")}
          </Button>
        </div>
      )}

      <DeferDialog
        isOpen={dialog === "defer"}
        count={Math.min(chosen.length, BATCH_LIMIT)}
        pending={batch.isPending}
        onCancel={closeDialog}
        onConfirm={(reason) => runBatch("defer", { reason })}
      />
      <ReassignDialog
        isOpen={dialog === "reassign"}
        ids={reassignIds}
        count={reassignIds.length}
        pending={batch.isPending}
        onCancel={closeDialog}
        onConfirm={(to) => runBatch("reassign", { to })}
      />
      <ConfirmDialog
        isOpen={dialog === "restore"}
        variant="info"
        title={t("judgment.claim.restore_title")}
        message={t("judgment.claim.restore_body", { n: String(sessionDeferred.length) })}
        confirmText={t("judgment.queue.restore_all")}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          const n = sessionDeferred.length;
          saveSessionDeferred([]);
          setDialog(null);
          showToast(t("judgment.claim.done_restore", { n: String(n) }), "success");
        }}
      />
    </div>
  );
}
