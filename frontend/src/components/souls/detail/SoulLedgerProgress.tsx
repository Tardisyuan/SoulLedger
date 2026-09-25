"use client";

import type { Disposition, Judgment, Reincarnation, Soul } from "@soulledger/core/api";
import { useQuery } from "@tanstack/react-query";
import { realmsApi, soulsApi } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteTopology } from "@/src/components/realms/RouteTopology";
import { buildTopology } from "@/src/lib/routeTopology";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { latest, stepStatuses } from "./soulProgress";

/**
 * 户头进度(四格)+ 行程条。两者读的是同一组 `StepStatus`,所以「当前」在两处
 * 不可能各说各的。
 *
 * 行程条是**界域页那张拓扑图 + 这个灵魂的 path**(`<RouteTopology mode="route">`,
 * 与 /realms 同一个组件)。它此前画的是「存活 → 庭 → 去处 → 轮回」四站一条线,
 * 因为 API 只给判决一个自由文本的 `court`;后端补上 realm 拓扑列与
 * `GET /souls/{id}/path/` 之后,四种形状同时上线(规范 v1 规则 16),形状字段缺失的
 * 文明画「一条线 · 示意」。站的状态只从 path 来 —— 见 src/lib/routeTopology.ts。
 */
export function SoulLedgerProgress({
  soul,
  judgments,
  dispositions,
  reincarnations,
  birthDisplay,
  deathDisplay,
}: {
  soul: Soul;
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  birthDisplay: string | null;
  deathDisplay: string | null;
}) {
  const { t, formatDate } = useI18n();

  const opened = judgments.length
    ? judgments.reduce((a, b) => (a.created_at <= b.created_at ? a : b))
    : null;
  const decided = latest(judgments.filter((j) => j.concluded_at), (j) => j.concluded_at);
  const disposition = latest(dispositions, (d) => d.executed_at ?? d.created_at);
  const rebirth = latest(reincarnations, (r) => r.reincarnated_at);

  const statuses = stepStatuses(soul.current_state, [
    true,
    judgments.length > 0,
    dispositions.length > 0,
    reincarnations.length > 0,
  ]);

  const missing = <MissingValue kind="unrecorded" />;
  const notYet = t("souls.detail.ledger.not_yet");

  const alive = soul.current_state === "ALIVE";
  const bodies: React.ReactNode[] = [
    <>
      {birthDisplay ?? missing} — {deathDisplay ?? (alive ? "" : missing)}
    </>,
    opened ? (
      <>
        {t("souls.detail.ledger.opened", { date: formatDate(opened.created_at) })}
        {decided?.concluded_at &&
          ` · ${t("souls.detail.ledger.decided", { date: formatDate(decided.concluded_at) })}`}
      </>
    ) : (
      missing
    ),
    disposition ? formatDate(disposition.executed_at ?? disposition.created_at) : missing,
    rebirth ? formatDate(rebirth.reincarnated_at) : missing,
  ];

  const labels = [
    t("souls.states.ALIVE"),
    t("souls.detail.timeline.stage_judging"),
    t("souls.detail.timeline.stage_disposed"),
    t("souls.detail.timeline.stage_reincarnating"),
  ];

  return (
    <div className="min-w-0">
      <ol
        aria-label={t("souls.detail.ledger.progress_label")}
        data-testid="soul-ledger-progress"
        className="grid grid-cols-2 md:grid-cols-4 border-b border-[oklch(var(--color-block))] font-mono text-2xs"
      >
        {statuses.map((status, i) => (
          <li
            key={i}
            data-step-status={status}
            aria-current={status === "current" ? "step" : undefined}
            className={`px-2 py-2 border-r border-[oklch(var(--color-rule))] last:border-r-0 ${
              status === "current"
                ? "bg-[oklch(var(--color-surface-2))] shadow-[inset_0_-3px_0_oklch(var(--color-ink))]"
                : ""
            }`}
          >
            <div
              className={
                status === "current"
                  ? "font-semibold text-[oklch(var(--color-ink))]"
                  : "text-[oklch(var(--color-ink-subtle))]"
              }
            >
              {String(i + 1).padStart(2, "0")} {labels[i]}
              {status === "current" && ` · ${t("souls.detail.ledger.current")}`}
            </div>
            <div className={status === "future" ? "text-[oklch(var(--color-ink-subtle))]" : "text-[oklch(var(--color-ink))]"}>
              {status === "future" ? notYet : bodies[i]}
            </div>
          </li>
        ))}
      </ol>

      <SoulRoute soulId={soul.id} civilization={soul.civilization} />
    </div>
  );
}

/** 行程:这个灵魂的 path 画在它文明的形状上。两份数据各自加载、各自报错。 */
function SoulRoute({ soulId, civilization }: { soulId: string; civilization: string }) {
  const { t } = useI18n();
  const realms = useQuery({
    queryKey: ["realms", "topology"],
    queryFn: () => realmsApi.list().then((r) => r.data.results),
    staleTime: 5 * 60_000,
  });
  const path = useQuery({
    queryKey: soulKeys.path(soulId),
    queryFn: () => soulsApi.path(soulId).then((r) => r.data),
  });

  return (
    <div data-testid="soul-route" className="min-w-0 max-w-full overflow-hidden py-3 border-b border-[oklch(var(--color-line))]">
      {realms.isError || path.isError ? (
        <p role="alert" className="text-2xs text-[oklch(var(--color-danger))]">
          ! {t("realms.topology.load_failed")}
        </p>
      ) : realms.isLoading || path.isLoading || !realms.data || !path.data ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : (
        <RouteTopology
          mode="route"
          compact
          title={t("souls.detail.ledger.route_title")}
          topology={buildTopology(civilization, realms.data, path.data)}
        />
      )}
    </div>
  );
}
