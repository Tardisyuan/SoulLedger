"use client";

import type { AppealLadder, AppealLadderStation, JudgmentAppeal } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";

/*
 * 上诉的站梯与方标(Design 第五十五批 E-1 / E-2)。字形照路线图图例:■ 已过 · ▪ 当前 · □ 未到 · ✕ 驳回。
 * 流程结束后剩下的 AHEAD 是「不再审」—— 那句文案词表里还没有,先只画灰的 □、不写状态,免得读成「还在等」。
 * 每站的结论是人写的(衬线),不写复核人(同申诉)。
 */

const GLYPH: Record<AppealLadderStation["state"], string> = { PASSED: "■", CURRENT: "▪", AHEAD: "□", REJECTED: "✕" };

/** 流程已经结束(走完或驳回):站梯不再动。 */
export const ladderOver = (appeal: Pick<JudgmentAppeal, "workflow_status">) =>
  appeal.workflow_status === "COMPLETED" || appeal.workflow_status === "REJECTED";

/** 「上诉」方标:2px ink 框,申诉那一行没有。 */
export function EscalatedTag() {
  const { t } = useI18n();
  return (
    <span data-testid="appeal-escalated-tag" className="inline-block border-2 border-[oklch(var(--color-ink))] px-1 text-xs font-medium leading-tight">
      {t("appeals.escalated_tag")}
    </span>
  );
}

export function stationName(station: AppealLadderStation, t: (key: string, vars?: Record<string, string>) => string) {
  return station.is_final
    ? t("appeals.ladder_final", { name: station.name })
    : t("appeals.ladder_station", { n: String(station.order), name: station.name });
}

/** 队列「当前」一格:第 n / total 站 · 站名 · 审理中。流程不在跑时 null。 */
export function ladderCurrentText(ladder: AppealLadder | null, t: (key: string, vars?: Record<string, string>) => string) {
  const station = ladder?.stations.find((s) => s.state === "CURRENT");
  if (!ladder || !station) return null;
  return [
    t("appeals.ladder_progress", { n: String(station.order), total: String(ladder.total) }),
    station.name,
    t("appeals.ladder_state.CURRENT"),
  ].join(" · ");
}

export function AppealLadderView({ appeal }: { appeal: Pick<JudgmentAppeal, "ladder" | "workflow_status"> }) {
  const { t } = useI18n();
  if (!appeal.ladder) return null;
  const over = ladderOver(appeal);
  return (
    <ol data-testid="appeal-ladder" className="space-y-2">
      {appeal.ladder.stations.map((s) => {
        const notHeard = over && s.state === "AHEAD";
        return (
          <li
            key={s.node}
            data-testid={`appeal-station-${s.order}`}
            data-state={notHeard ? "NOT_HEARD" : s.state}
            className={`grid grid-cols-[1.25rem_1fr] gap-x-2 text-sm ${notHeard || s.state === "AHEAD" ? "text-[oklch(var(--color-ink-subtle))]" : "text-[oklch(var(--color-ink))]"}`}
          >
            <span aria-hidden="true" className="font-mono">{GLYPH[s.state]}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className={s.state === "CURRENT" ? "font-medium" : undefined}>{stationName(s, t)}</span>
                {!notHeard && <span className="text-xs">{t(`appeals.ladder_state.${s.state}`)}</span>}
              </div>
              {s.note && <p className="font-serif whitespace-pre-wrap">{s.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
