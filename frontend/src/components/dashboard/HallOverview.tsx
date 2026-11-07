"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, judgmentApi, judgmentAppealsApi } from "@soulledger/core/api";
import type { JudgmentHallStats } from "@soulledger/core/api/judgment";
import { localName } from "@soulledger/core/domain/localName";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useShellCommands, type ShellCommand } from "@/src/lib/shellCommands";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_STROKE, TREND_TOKENS } from "@/lib/chart-colors";
import { CivEmblem } from "@/src/components/brand/CivEmblem";
import { civSkinOf } from "@/src/lib/civSkin";
import type { SealCiv } from "@/src/components/plaque/Seal";

/**
 * 概览屏(规范 v4 第七批 S04,`overview.*`):左边一张大卡(今日待审、本月已结环、三个读数),右边上「近 12 周结案」、
 * 下「待经手」。数全部来自 `GET /judgment/hall-stats/`(`backend/apps/judgment/hall_stats.py` 写着每个数怎么算),
 * 「待经手」三类各取本页列表接口的前三条:退回重审(`/judgment/?returned=true`)、申诉(`/judgment/appeals/?status=PENDING`)、
 * 会审邀请(`/dispatch/cross-tenant-judgments/?side=participating&status=PROPOSED`)。
 *
 * 卡片是 `.v4-card`(深色 1px 线、浅色两层淡阴影),圆角 6(面板);主卡四角是金属色角饰(`.v4-corner`)。
 * 大数字是 88(`text-display-xl`,v4 加的一档,只给这里与年报);进页时它从 0 滚上来、「本月已结」环从 0 扫到实际值
 * (`.v4-roll` / `.v4-ring-sweep`,globals.css,减少动态效果时直接是终态)。「其中 n 件已过期限」的 n 是金属色。
 */

const CARD =
  "v4-card relative min-w-0 rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]";
const DAY_S = 86_400;

const RING_C = 2 * Math.PI * 26;

/** 「本月已结」环:直径 64,线宽 5,金属色;没有数(本月既没结也没待审)时只画底环。挂上时从 0 扫到 pct。 */
function DoneRing({ pct }: { pct: number | null }) {
  const c = RING_C;
  return (
    <svg aria-hidden="true" width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r="26" fill="none" strokeWidth="5" className="stroke-[oklch(var(--color-line))]" />
      {pct != null && (
        <circle
          data-done-ring=""
          cx="32"
          cy="32"
          r="26"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c.toFixed(1)}
          strokeDashoffset={(c * (1 - pct / 100)).toFixed(1)}
          transform="rotate(-90 32 32)"
          className="v4-ring-sweep stroke-[oklch(var(--color-metal))]"
          style={{ "--ring-c": c.toFixed(1) } as React.CSSProperties}
        />
      )}
      {pct != null && (
        <text x="32" y="33" textAnchor="middle" dominantBaseline="central" className="fill-[oklch(var(--color-ink))] font-mono text-sm">
          {pct}
        </text>
      )}
    </svg>
  );
}

/** 大数字:看得见的那层从 0 滚到 n(`.v4-roll`,只 CSS),读屏与复制拿到的是 sr-only 里的终值。 */
function RollingCount({ n }: { n: number }) {
  return (
    <>
      <span className="sr-only">{n}</span>
      <span aria-hidden="true" data-roll={n} className="v4-roll" style={{ "--roll-n": n } as React.CSSProperties} />
    </>
  );
}

/** `overview.count_unit`「件 · 其中 {n} 件已过期限」:n 用金属色(定稿 `.metal`,600)。按占位符把句子切开,词序归语言包。 */
function OverdueLine({ t, n }: { t: (k: string, p?: Record<string, string>) => string; n: number }) {
  const [before, after = ""] = t("overview.count_unit", { n: "\u0000" }).split("\u0000");
  return (
    <div data-overview-overdue="" className="mt-1 text-md font-normal text-[oklch(var(--color-ink))]">
      {before}
      <span data-overdue-count="" className="font-semibold text-[oklch(var(--color-metal))]">{n}</span>
      {after}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[oklch(var(--color-ink-muted))]">{label}</div>
      <div className="font-mono text-xl tabular-nums text-[oklch(var(--color-ink))]">{value}</div>
    </div>
  );
}

function HeroCard({ stats, loading, failed }: { stats?: JudgmentHallStats; loading: boolean; failed: boolean }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const router = useRouter();
  const name = user?.display_name || user?.username || "";
  // 右上角是本殿文明的主视觉(v4 S04,250 宽,压出卡右沿一点);中性皮(管理员、没有文明的殿)不画。
  const skin = civSkinOf(user?.tenant?.code ?? null);

  // 认领下一件:取队列游标的第一件,不是自己手上的就认领,然后进审判台。队列空了说一句 `empty.body`。
  const { mutate: claimNext, isPending: claiming } = useMutation({
    mutationFn: async () => {
      const next = (await judgmentApi.next()).data.judgment;
      if (next && next.claimed_by !== user?.id) await judgmentApi.claim(next.id);
      return next;
    },
    onSuccess: (next) => (next ? router.push(`/judgment/${next.id}`) : showToast(t("empty.body"), "info")),
    onError: () => showToast(t("common.error"), "error"),
  });

  const commands = useMemo<ShellCommand[]>(
    () => [
      { id: "overview.claim_next", label: t("overview.claim_next"), run: () => claimNext() },
      { id: "overview.open_queue", label: t("overview.open_queue"), run: () => router.push("/judgment") },
    ],
    [t, router, claimNext],
  );
  useShellCommands(commands);

  const value = (n: number | null | undefined, render: (n: number) => React.ReactNode = (x) => x) =>
    loading ? <Skeleton as="span" className="inline-block h-6 w-10" /> : n == null ? <MissingValue kind={failed ? "unrecorded" : "inapplicable"} /> : render(n);

  return (
    <section data-overview-hero="" className={`${CARD} flex flex-col overflow-hidden p-6 lg:row-span-2 lg:min-h-105`}>
      <span aria-hidden="true" className="v4-corner" />
      {skin !== "neutral" && <CivEmblem civ={skin as SealCiv} size={250} className="absolute -right-1.5 top-7.5 max-md:hidden" />}
      <div className="relative max-w-xs">
        <div className="text-sm text-[oklch(var(--color-ink-muted))]">{t("overview.greet", { name })}</div>
        <div className="mt-2 flex items-center gap-4">
          <span data-overview-pending="" className="font-title text-display-xl tabular-nums text-[oklch(var(--color-main-ink))]">
            {loading ? <Skeleton as="span" className="inline-block h-23 w-20" /> : stats ? <RollingCount n={stats.pending} /> : <MissingValue kind="unrecorded" />}
          </span>
          {!loading && stats && <DoneRing pct={stats.month_done_pct} />}
        </div>
        {stats && (
          <>
            <OverdueLine t={t} n={stats.overdue} />
            {stats.month_done_pct != null && (
              <div className="text-sm text-[oklch(var(--color-ink-muted))]">
                {t("overview.month_done_pct", { pct: String(stats.month_done_pct) })}
              </div>
            )}
          </>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" variant="primary" loading={claiming} onClick={() => claimNext()}>
            {t("overview.claim_next")}
          </Button>
          <Link href="/judgment" className={buttonVariants({ variant: "secondary" })}>
            {t("overview.open_queue")}
          </Link>
        </div>
      </div>
      <div className="relative mt-auto flex flex-wrap gap-8 pt-6">
        <Figure label={t("officer_app.stats.concluded_this_month")} value={value(stats?.concluded_this_month)} />
        <Figure
          label={t("overview.stat.avg_time")}
          value={value(stats?.avg_days, (n) => t("overview.days", { n: n.toFixed(1) }))}
        />
        <Figure label={t("overview.stat.returned")} value={value(stats?.returned_this_month)} />
      </div>
    </section>
  );
}

const W = 300;
const H = 80;

/** 近 12 周结案:本季实线(文明字色)、上季虚线(金属色),线宽与虚线照 `CHART_STROKE`;十字线停在指着的那一周,默认本周。 */
function TrendCard({ stats, loading }: { stats?: JudgmentHallStats; loading: boolean }) {
  const { t } = useI18n();
  const weeks = stats?.weeks ?? [];
  const [at, setAt] = useState<number | null>(null);
  const last = weeks.length - 1;
  const i = at ?? last;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.concluded, w.previous_quarter]));
  const x = (k: number) => (last > 0 ? (k / last) * W : W / 2);
  const y = (v: number) => H - 4 - (v / max) * (H - 12);
  const line = (pick: (w: (typeof weeks)[number]) => number) => weeks.map((w, k) => `${x(k).toFixed(1)},${y(pick(w)).toFixed(1)}`).join(" ");
  const pick = (clientX: number, box: DOMRect) =>
    setAt(Math.max(0, Math.min(last, Math.round(((clientX - box.left) / Math.max(1, box.width)) * last))));
  const week = weeks[i];
  const left = `${(x(i) / W) * 100}%`;
  const dot = (v: number, token: string) => (
    <svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" className="pointer-events-none absolute -mt-1 -ml-1" style={{ left, top: y(v) }}>
      <circle cx="4.5" cy="4.5" r="4.5" className="fill-[oklch(var(--color-surface-1))]" />
      <circle cx="4.5" cy="4.5" r="3.5" style={{ fill: `oklch(var(${token}))` }} />
    </svg>
  );

  return (
    <section data-overview-trend="" className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-title text-lg text-[oklch(var(--color-ink))]">{t("overview.trend.title")}</h2>
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("overview.trend.scope")}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-32 w-full" />
      ) : weeks.length === 0 ? (
        <p className="mt-3 text-sm"><MissingValue kind="unrecorded" /></p>
      ) : (
        <>
          <div className="mt-2 mb-2 flex gap-6">
            <div>
              <div className="text-xs text-[oklch(var(--color-ink-muted))]">{t("overview.trend.this_week")}</div>
              <div className="font-mono text-xl font-semibold tabular-nums text-[oklch(var(--color-main-ink))]">{weeks[last].concluded}</div>
            </div>
            <div>
              <div className="text-xs text-[oklch(var(--color-ink-muted))]">{t("overview.trend.last_quarter_same")}</div>
              <div className="font-mono text-xl tabular-nums text-[oklch(var(--color-ink))]">{weeks[last].previous_quarter}</div>
            </div>
          </div>
          <div
            // 一个选周的滑块:左右键或指针移十字线,读屏念「第 n 周 · 日期」。
            role="slider"
            tabIndex={0}
            aria-label={t("overview.trend.title")}
            aria-valuemin={1}
            aria-valuemax={weeks.length}
            aria-valuenow={i + 1}
            aria-valuetext={t("overview.trend.week", { n: String(i + 1), date: week.week_start.slice(5) })}
            className="relative h-20"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setAt(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setAt(Math.max(0, i - 1));
              else if (e.key === "ArrowRight") setAt(Math.min(last, i + 1));
              else return;
              e.preventDefault();
            }}
          >
            <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-20 w-full overflow-visible">
              <line x1="0" y1={H - 1} x2={W} y2={H - 1} strokeWidth={CHART_STROKE.axis} vectorEffect="non-scaling-stroke" className="stroke-[oklch(var(--color-line))]" />
              <polyline
                data-series="previous"
                points={line((w) => w.previous_quarter)}
                fill="none"
                strokeWidth={CHART_STROKE.line}
                strokeDasharray={CHART_STROKE.dash}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: `oklch(var(${TREND_TOKENS.previous}))` }}
              />
              <polyline
                data-series="current"
                points={line((w) => w.concluded)}
                fill="none"
                strokeWidth={CHART_STROKE.line}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: `oklch(var(${TREND_TOKENS.current}))` }}
              />
              <line x1={x(i)} y1="0" x2={x(i)} y2={H - 1} strokeWidth={CHART_STROKE.crosshair} vectorEffect="non-scaling-stroke" className="stroke-[oklch(var(--color-ink-muted))]" />
            </svg>
            {dot(week.concluded, TREND_TOKENS.current)}
            {dot(week.previous_quarter, TREND_TOKENS.previous)}
            <div
              data-trend-tip=""
              aria-live="polite"
              className="pointer-events-none absolute -top-2 rounded-panel bg-[oklch(var(--color-surface-2))] px-3 py-2 text-xs whitespace-nowrap shadow-overlay"
              style={i > last / 2 ? { right: `calc(${100 - (x(i) / W) * 100}% + 12px)` } : { left: `calc(${left} + 12px)` }}
            >
              <div className="text-[oklch(var(--color-ink-muted))]">
                {t("overview.trend.week", { n: String(i + 1), date: week.week_start.slice(5) })}
              </div>
              <div className="text-[oklch(var(--color-ink))]">
                <span aria-hidden="true" style={{ color: `oklch(var(${TREND_TOKENS.current}))` }}>━ </span>
                {t("overview.trend.this_quarter")} <b className="font-mono">{week.concluded}</b>
              </div>
              <div className="text-[oklch(var(--color-ink))]">
                <span aria-hidden="true" style={{ color: `oklch(var(${TREND_TOKENS.previous}))` }}>┅ </span>
                {t("overview.trend.last_quarter")} <b className="font-mono">{week.previous_quarter}</b>
              </div>
            </div>
          </div>
          <div aria-hidden="true" className="mt-2 flex gap-3 text-xs text-[oklch(var(--color-ink-muted))]">
            <span><span style={{ color: `oklch(var(${TREND_TOKENS.current}))` }}>━</span> {t("overview.trend.this_quarter")}</span>
            <span><span style={{ color: `oklch(var(${TREND_TOKENS.previous}))` }}>┅</span> {t("overview.trend.last_quarter")}</span>
          </div>
        </>
      )}
    </section>
  );
}

interface TodoRow {
  key: string;
  href: string;
  text: string;
  /** 右栏:到期 / 待回复;申诉没有复核期限(`deadline` 是申诉期),右栏空着。 */
  aside?: string;
}

/** 剩余秒数 → 「今天到期」「n 日后到期」「超 n 日」。 */
function dueText(t: (k: string, p?: Record<string, string>) => string, seconds: number | null | undefined): string | undefined {
  if (seconds == null) return undefined;
  if (seconds < 0) return t("queue.deadline.over", { n: String(Math.ceil(-seconds / DAY_S)) });
  const days = Math.floor(seconds / DAY_S);
  return days < 1 ? t("overview.todo.due_today") : t("overview.todo.due_in", { n: String(days) });
}

function TodoCard() {
  const { t, locale } = useI18n();
  const { hasPermission } = usePermissions();
  const canCross = hasPermission("cross_judgment.read");
  const returnedQ = useQuery({
    queryKey: ["overview", "todo", "returned"],
    queryFn: async () => (await judgmentApi.list({ returned: "true", page_size: "3" })).data.results,
  });
  const appealsQ = useQuery({
    queryKey: ["overview", "todo", "appeals"],
    queryFn: async () => (await judgmentAppealsApi.list({ status: "PENDING", page_size: "3" })).data.results,
  });
  const jointQ = useQuery({
    queryKey: ["overview", "todo", "joint"],
    queryFn: async () =>
      (await crossTenantJudgmentsApi.list({ side: "participating", status: "PROPOSED", page_size: "3" })).data.results,
    enabled: canCross,
  });
  const queries = canCross ? [returnedQ, appealsQ, jointQ] : [returnedQ, appealsQ];
  const loading = queries.some((q) => q.isLoading);
  const failed = queries.filter((q) => q.isError);

  const rows: TodoRow[] = [
    ...(returnedQ.data ?? []).map((j) => ({
      key: `r-${j.id}`,
      href: `/judgment/${j.id}`,
      text: t("overview.todo.returned", { case: j.case_number }),
      aside: dueText(t, j.deadline_remaining_seconds),
    })),
    ...(appealsQ.data ?? []).map((a) => ({
      key: `a-${a.id}`,
      href: `/judgment/appeals/${a.id}`,
      text: t("overview.todo.appeal", { soul: a.soul_name }),
    })),
    ...(canCross ? jointQ.data ?? [] : []).map((c) => ({
      key: `j-${c.id}`,
      href: `/cross-judgments/${c.id}`,
      text: t("overview.todo.joint", { hall: localName(c, locale, "initiating_tenant_display_name") }),
      aside: t("soul_inbox.folder.awaiting_reply"),
    })),
  ];

  return (
    <section data-overview-todo="" className={`${CARD} p-4`}>
      <h2 className="mb-2 font-title text-lg text-[oklch(var(--color-ink))]">{t("overview.todo.title")}</h2>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          {rows.length > 0 ? (
            <ul>
              {rows.map((row, k) => (
                <li key={row.key} className={k ? "border-t border-[oklch(var(--color-line))]" : undefined}>
                  <Link href={row.href} className="flex min-h-11 items-center gap-3 text-sm text-[oklch(var(--color-ink))] hover:underline">
                    <span aria-hidden="true" className="text-xs text-[oklch(var(--color-main-ink))]">◆</span>
                    <span title={row.text} className="min-w-0 flex-1 truncate">{row.text}</span>
                    {row.aside && <span className="shrink-0 text-xs text-[oklch(var(--color-ink-muted))]">{row.aside}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : failed.length === 0 ? (
            <p className="text-sm text-[oklch(var(--color-ink-subtle))]">
              <span aria-hidden="true">✓ </span>
              {t("dashboard.todo.none")}
            </p>
          ) : null}
          {failed.length > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <span role="alert" className="text-sm text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {t("dashboard.todo.load_error")}
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => failed.forEach((q) => void q.refetch())}>
                {t("common.retry")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 概览的三张卡;只给能看审判的人(`hall-stats` 要 `judgment.read`)。 */
export function HallOverview() {
  const { t } = useI18n();
  const statsQ = useQuery({
    queryKey: [...judgmentKeys.all, "hall-stats"],
    queryFn: async () => (await judgmentApi.hallStats()).data,
    staleTime: 60_000,
  });
  return (
    <div data-overview="" className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
      {statsQ.isError && (
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))] lg:col-span-2">
          <span aria-hidden="true">✕ </span>
          {t("dashboard.error_load")}
        </p>
      )}
      <HeroCard stats={statsQ.data} loading={statsQ.isLoading} failed={statsQ.isError} />
      <TrendCard stats={statsQ.data} loading={statsQ.isLoading} />
      <TodoCard />
    </div>
  );
}
