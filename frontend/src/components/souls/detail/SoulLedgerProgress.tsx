"use client";

import type { Disposition, Judgment, Reincarnation, Soul } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { latest, stepStatuses, type StepStatus } from "./soulProgress";

/**
 * 户头进度(四格)+ 行程条。两者读的是同一组 `StepStatus`,所以「当前」在两处
 * 不可能各说各的。
 *
 * 行程条画的是**一条线**,站点是这个灵魂真实走过的四站:存活 → 它最近一次审判的
 * 庭(`court`,没有就写「审判」)→ 最近一次处置的去处(`realm_name`)→ 轮回。
 * 规范 §1.8 的四种拓扑(十殿一线 / 九层漏斗 / 十二时之河 / 三岔路)要的是
 * 「灵魂此刻在第几殿 / 第几层 / 第几时」,而 API 只给每份判决一个自由文本的
 * `court` —— 拿它去解析殿号就是在编数据。所以四种文明都画这条线,拓扑等后端
 * 给出逐站位置再说。
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
  const lastJudgment = latest(judgments, (j) => j.created_at);
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

  const stations = [
    labels[0],
    lastJudgment?.court || labels[1],
    disposition?.realm_name || disposition?.realm_code || labels[2],
    labels[3],
  ];

  return (
    <div>
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

      <div className="py-3 border-b border-[oklch(var(--color-line))] overflow-x-auto">
        <div className="flex justify-between gap-3 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          <span>{t("souls.detail.ledger.route_title")}</span>
          <span aria-hidden="true">{t("souls.detail.ledger.route_legend")}</span>
        </div>
        <ol data-testid="soul-route" className="grid grid-cols-4 mt-2 min-w-60">
          {stations.map((name, i) => (
            <RouteStation key={i} name={name} status={statuses[i]} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function RouteStation({ name, status }: { name: string; status: StepStatus }) {
  const walked = status !== "future";
  return (
    <li data-route-status={status} aria-current={status === "current" ? "step" : undefined} className="pr-1">
      <div
        aria-hidden="true"
        className={
          walked
            ? "border-t-[3px] border-[oklch(var(--color-ink))]"
            : "border-t border-dashed border-[oklch(var(--color-ink-subtle))]"
        }
      />
      <div
        aria-hidden="true"
        className={
          status === "current"
            ? "w-2.5 h-2.5 -mt-1.5 bg-[oklch(var(--color-accent))]"
            : status === "done"
              ? "w-2 h-2 -mt-1 bg-[oklch(var(--color-ink))]"
              : "w-2 h-2 -mt-1 bg-[oklch(var(--color-canvas))] border border-[oklch(var(--color-ink-subtle))]"
        }
      />
      <div
        title={name}
        className={`text-2xs mt-1 truncate ${
          walked ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-subtle))]"
        } ${status === "current" ? "font-semibold" : ""}`}
      >
        {name}
      </div>
    </li>
  );
}
