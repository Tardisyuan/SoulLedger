"use client";

import type { AppealLadder, AppealLadderStation, JudgmentAppeal } from "@soulledger/core/api";
import { finalStationName } from "@soulledger/core/domain/appeals";
import { useI18n } from "@/src/contexts/I18nContext";

/*
 * 上诉的站梯与方标(Design 第五十五批 E-1 / E-2,补充 55b E-3)。字形照路线图图例:■ 已过 · ▪ 当前 · □ 未到 · ✕ 驳回 ·
 * ◇ 待作出结论(与灵魂状态「审判中」、裁决「待定」同一个字形)。
 * 终审(`is_final` 那一站)不画在站梯里,而是站梯下面虚线隔开的单独一行(55b):未到 · 不再审 · ◇ 待作出结论(浅底)·
 * ■ 维持原判 / 改判。站名「终审 · {{name}}」,name 去掉节点名末尾的「 · 终审」(`finalStationName`,55c),
 * 状态(`ladder_final_pending`「待作出结论」)写在右侧。
 * 流程结束后剩下的 AHEAD 是「不再审」(第五十六批 U-4 `ladder_state.NOT_HEARD`):灰的 □ 加这句,和「未到」分得开。
 * 每站的结论是人写的(衬线),不写复核人(同申诉)。
 */

type T = (key: string, vars?: Record<string, string>) => string;

const GLYPH: Record<AppealLadderStation["state"], string> = { PASSED: "■", CURRENT: "▪", AHEAD: "□", REJECTED: "✕", AWAITING_FINAL: "◇" };

/** 流程已经结束(走完或驳回):站梯不再动。 */
export const ladderOver = (appeal: Pick<JudgmentAppeal, "workflow_status">) =>
  appeal.workflow_status === "COMPLETED" || appeal.workflow_status === "REJECTED";

/** 终审那一站(单独一行画);没有就 undefined。 */
export const finalStation = (ladder: AppealLadder | null | undefined) => ladder?.stations.find((s) => s.is_final);

/** 站梯走完 · 待终审。 */
export const awaitingFinal = (ladder: AppealLadder | null | undefined) => finalStation(ladder)?.state === "AWAITING_FINAL";

/** 「查看审批流程 →」的锚点(第五十六批 W-1):流程停在的那一站(含待终审的终审站)`#node-<节点 id>`;没有就空串。 */
export function ladderAnchor(ladder: AppealLadder | null | undefined) {
  const station = ladder?.stations.find((s) => s.state === "CURRENT" || s.state === "AWAITING_FINAL");
  return station ? `#node-${station.node}` : "";
}

/** 「上诉」方标:2px ink 框,申诉那一行没有。 */
export function EscalatedTag() {
  const { t } = useI18n();
  return (
    <span data-testid="appeal-escalated-tag" className="inline-block border-2 border-[oklch(var(--color-ink))] px-1 text-xs font-medium leading-tight">
      {t("appeals.escalated_tag")}
    </span>
  );
}

export function stationName(station: AppealLadderStation, t: T) {
  return station.is_final
    ? t("appeals.ladder_final", { name: finalStationName(station.name) })
    : t("appeals.ladder_station", { n: String(station.order), name: station.name });
}

/** 队列「当前」一格:第 n / 站数 站 · 站名 · 审理中(站数不含终审);待终审时 ◇ 站梯走完 · 待终审。流程不在跑时 null。 */
export function ladderCurrentText(ladder: AppealLadder | null, t: T) {
  if (awaitingFinal(ladder)) return `${GLYPH.AWAITING_FINAL} ${t("appeals.ladder_state.AWAITING_FINAL")}`;
  const station = ladder?.stations.find((s) => s.state === "CURRENT");
  if (!ladder || !station) return null;
  const total = ladder.stations.filter((s) => !s.is_final).length;
  return [
    station.is_final ? t("appeals.ladder_final", { name: finalStationName(station.name) }) : t("appeals.ladder_progress", { n: String(station.order), total: String(total) }),
    ...(station.is_final ? [] : [station.name]),
    t("appeals.ladder_state.CURRENT"),
  ].join(" · ");
}

export function AppealLadderView({ appeal }: { appeal: Pick<JudgmentAppeal, "ladder" | "workflow_status" | "status"> }) {
  const { t } = useI18n();
  if (!appeal.ladder) return null;
  const over = ladderOver(appeal);
  const final = finalStation(appeal.ladder);
  const row = (s: AppealLadderStation) => {
    const notHeard = over && s.state === "AHEAD";
    // The final station passing hands the appeal to the final judge: what it says is the appeal's own result.
    const state = notHeard
      ? t("appeals.ladder_state.NOT_HEARD")
      : s.state === "AWAITING_FINAL"
        ? t("appeals.ladder_final_pending")
        : s.is_final && s.state === "PASSED"
          ? appeal.status === "UPHELD" || appeal.status === "AMENDED"
            ? t(`appeals.status.${appeal.status}`)
            : null
          : t(`appeals.ladder_state.${s.state}`);
    return (
      <li
        key={s.node}
        data-testid={s.is_final ? "appeal-station-final" : `appeal-station-${s.order}`}
        data-state={notHeard ? "NOT_HEARD" : s.state}
        className={`grid grid-cols-[1.25rem_1fr] gap-x-2 text-sm ${notHeard || s.state === "AHEAD" ? "text-[oklch(var(--color-ink-subtle))]" : "text-[oklch(var(--color-ink))]"} ${s.state === "AWAITING_FINAL" ? "bg-[oklch(var(--color-surface-2))] px-2 py-1" : ""}`}
      >
        <span aria-hidden="true" className="font-mono">{GLYPH[s.state]}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className={s.state === "CURRENT" ? "font-medium" : undefined}>{stationName(s, t)}</span>
            {state && <span className="text-xs">{state}</span>}
          </div>
          {s.note && <p className="font-serif whitespace-pre-wrap">{s.note}</p>}
        </div>
      </li>
    );
  };
  return (
    <div data-testid="appeal-ladder">
      <ol className="space-y-2">{appeal.ladder.stations.filter((s) => !s.is_final).map(row)}</ol>
      {final && <ol className="mt-3 border-t border-dashed border-[oklch(var(--color-line))] pt-3">{row(final)}</ol>}
    </div>
  );
}
