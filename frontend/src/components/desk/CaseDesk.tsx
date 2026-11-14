"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, type JudgmentQueueGroup, type JudgmentQueueSource } from "@soulledger/core/api/judgment";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { courtLabel } from "@soulledger/core/domain/courts";
import { formatIsoDay } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { CaseNumber } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { isTypingTarget, useHotkeys, useShortcutHelp } from "@/src/lib/hotkeys";
import { DESK_GROUPS, dedupeGroups, deskTag, heldBeforeClaim, matchesSearch, onDeskCount, overviewParts, rowNotes, sourceChips, sourceLabel, step } from "./deskRules";
import { claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { OpenCase } from "./OpenCase";
import s from "./desk.module.css";

/**
 * 案卷台(Design 第三十批 第 2 步):门栏(AppLayout 的 `DoorRail`)右边,左是案卷摞(360),右是摊开的一份。
 * 摞:标题、概览行、来源 chip、搜索(`/`)、四组 —— 我认领 / 待定 / 待认领 / 他人手上(最后,只读)。
 * 键:J / K 上下一件、↵ 打开卷宗、C 认领、/ 搜索;打字时不接,单键总开关关掉时也不接(`lib/hotkeys.ts`)。
 * 393:一栏;点开一件是整屏(一次导航,`?case=<id>`,系统返回回到摞),「‹ 案卷台」回来,「第 n / N 件」。
 *
 * 与官员端 `mobile-officer/src/screens/queue.tsx` 同一套规矩;来源读服务端的 `source`(`deskRules.sourceOf`)。
 */
const SHORTCUTS = [
  { key: "J · K", label: "caseDesk.keys.move" },
  { key: "↵", label: "caseDesk.keys.open" },
  { key: "C", label: "caseDesk.keys.claim" },
  { key: "/", label: "caseDesk.keys.search" },
] as const;

const listParams = (group: JudgmentQueueGroup, source: JudgmentQueueSource | "all"): Record<string, string> => ({
  group,
  ordering: "created_at",
  ...(source === "all" ? {} : { source }),
});

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

  // ponytail: 每组只取第一页(与审判队列同一页长);一组上百件时加「加载更多」。
  const lists = useQueries({
    queries: DESK_GROUPS.map((group) => ({
      queryKey: judgmentKeys.list(listParams(group, source)),
      queryFn: async () => (await judgmentApi.list(listParams(group, source))).data,
    })),
  });
  // 概览与 chip 用不筛的数(`sources` 本来就不随 `source` 变);组标题上的数跟着筛选走。
  const allCounts = useQuery({ queryKey: judgmentKeys.queueCounts(), queryFn: async () => (await judgmentApi.queueCounts()).data });
  const filteredCounts = useQuery({
    queryKey: judgmentKeys.queueCounts({ source: source === "all" ? undefined : source }),
    queryFn: async () => (await judgmentApi.queueCounts(source === "all" ? undefined : { source })).data,
    enabled: source !== "all",
  });
  const groupCounts = source === "all" ? allCounts.data : filteredCounts.data;
  // 与概览页(HallOverview)同一把键:本月已结的百分比是殿的数。
  const stats = useQuery({ queryKey: [...judgmentKeys.all, "hall-stats"], queryFn: async () => (await judgmentApi.hallStats()).data });

  const groups = dedupeGroups(DESK_GROUPS.map((group, i) => ({ group, rows: lists[i].data?.results ?? [] }))).map((g) => ({
    ...g,
    rows: g.rows.filter((r) => matchesSearch(r, query)),
  }));
  const flat = groups.flatMap((g) => g.rows.map((row) => ({ row, group: g.group })));
  const ids = flat.map((f) => f.row.id);
  const chosen = caseParam ?? picked;
  const currentId = chosen && ids.includes(chosen) ? chosen : (ids[0] ?? null);
  const current = flat.find((f) => f.row.id === currentId) ?? null;
  const position = current ? { n: ids.indexOf(current.row.id) + 1, total: ids.length } : null;

  const loading = lists.some((l) => l.isPending);
  const failed = lists.find((l) => l.isError);

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

  useShortcutHelp(SHORTCUTS);
  useHotkeys({
    j: () => select(step(ids, currentId, 1)),
    k: () => select(step(ids, currentId, -1)),
    c: () => {
      if (current && claimable && !move.isPending) move.mutate({ id: current.row.id, kind: "claim" });
    },
    "/": () => searchRef.current?.focus(),
  });
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

  const overview = overviewParts(t, onDeskCount(allCounts.data), allCounts.data?.overdue ?? null, stats.data?.month_done_pct ?? null);
  const chips = sourceChips(t, allCounts.data);
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
          {chips.length > 1 ? (
            <div className={s.chips} data-testid="desk-sources" role="group" aria-label={t("caseDesk.sources_label")}>
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
                  <Link key={c.key} href={c.href} className={s.chip} data-testid={`desk-source-${c.key}`}>
                    {c.label}
                    <span className={s.chipCount}>{c.count}</span>
                    <span aria-hidden="true">›</span>
                  </Link>
                ),
              )}
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

        {failed && !lists.some((l) => l.data) ? (
          <p className={s.note} role="alert">
            {t("caseDesk.load_failed")}{" "}
            <Button size="sm" onClick={() => lists.forEach((l) => void l.refetch())}>
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
          groups.map(({ group, rows }) =>
            rows.length === 0 ? null : (
              <section key={group} data-testid={`desk-group-${group}`} aria-labelledby={`desk-group-${group}`}>
                <h2 id={`desk-group-${group}`} data-h2-role="column" className={s.groupHead}>
                  <span>{t(`officer_app.desk.groups.${group}`)}</span>
                  <span className={s.groupCount}>{String(query ? rows.length : (groupCounts?.[group] ?? rows.length))}</span>
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

      <section className={s.case} aria-label={t("caseDesk.open_case")} data-testid="desk-case">
        {current && position ? (
          <OpenCase
            row={current.row}
            group={current.group}
            position={position}
            counts={allCounts.data ?? null}
            monthPct={stats.data?.month_done_pct ?? null}
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

      <p className="sr-only" aria-live="polite" data-testid="desk-announce">
        {announce}
      </p>
    </div>
  );
}
