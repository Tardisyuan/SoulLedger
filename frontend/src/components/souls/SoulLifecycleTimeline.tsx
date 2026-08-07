"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import type { Soul } from "@/lib/api/souls";
import type { SoulEvent } from "@/lib/api/events";
import type { Judgment } from "@/lib/api/judgment";
import type { Disposition } from "@/lib/api/disposition";
import type { Reincarnation } from "@/lib/api/reincarnation";
import type { LedgerRecord } from "@/lib/api/ledger";
import {
  buildKarmaRows,
  buildBirthMarker,
  buildDeathMarker,
  buildJudgmentMarkers,
  buildDispositionMarkers,
  buildReincarnationMarkers,
  buildSystemRows,
  computeFutureStages,
  buildFutureRows,
  buildActionRow,
  buildCycleBandRows,
  filterRows,
  sortRows,
  describeSystemEvent,
  type SpineTab,
  type SpineRow,
  type FutureStageKey,
} from "./soulLifecycleRows";

type TFunc = (key: string, params?: Record<string, string>) => string;

function tfFactory(t: TFunc) {
  return (key: string, fallback: string, params?: Record<string, string>) => {
    if (t(key) === key) {
      return params
        ? Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), fallback)
        : fallback;
    }
    return t(key, params);
  };
}

const PIPELINE_STEPS = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "ALIVE_NEXT"] as const;

function currentStepPosition(state: string, hasReincarnated: boolean): number {
  switch (state) {
    case "ALIVE":
      return hasReincarnated ? 4 : 0;
    case "JUDGING":
      return 1;
    case "DISPOSED":
    case "SETTLED":
    case "LOST":
      return 2;
    case "REINCARNATING":
      return 3;
    default:
      return 0;
  }
}

const TONE_DOT: Record<string, string> = {
  neutral: "bg-[hsl(var(--color-ink-subtle))]",
  merit: "bg-[hsl(var(--color-karma-merit))]",
  demerit: "bg-[hsl(var(--color-karma-demerit))]",
  info: "bg-[hsl(var(--color-status-info))]",
  accent: "bg-[hsl(var(--color-accent))]",
};

interface RowShellProps {
  date: string | null;
  dotClassName: string;
  dashed?: boolean;
  hideConnector?: boolean;
  highlight?: boolean;
  tint?: boolean;
  /** SETTLED-only spine terminal (see §3 of the Stage 5 design doc): "filled"
   * is a larger ringed dot — someone is still there (Aaru, Heaven, eternal
   * Hell). "flush" drops the dot for a bare line-end — annihilation, so
   * there is nobody left for a further entry to be about. Both render on the
   * row for the soul's terminal disposition; the badge and destination text
   * stay outcome-neutral, this is the one channel that carries the fate. */
  terminalVariant?: "filled" | "flush";
  children: React.ReactNode;
  right?: React.ReactNode;
}

function RowShell({ date, dotClassName, dashed, hideConnector, highlight, tint, terminalVariant, children, right }: RowShellProps) {
  return (
    <div
      className={`flex items-stretch gap-3 ${tint ? "bg-[hsl(var(--color-accent)/0.06)] rounded-md" : ""} ${
        highlight ? "bg-[hsl(var(--color-accent)/0.1)] rounded-md border border-[hsl(var(--color-accent)/0.4)]" : ""
      }`}
    >
      <div className="w-16 shrink-0 text-[11px] text-[hsl(var(--color-ink-subtle))] text-right pt-2">{date ?? "—"}</div>
      <div className="flex flex-col items-center shrink-0">
        {terminalVariant === "flush" ? (
          <span className="w-2.5 h-px mt-3 bg-[hsl(var(--color-hairline-strong))]" aria-hidden="true" />
        ) : (
          <span
            className={
              terminalVariant === "filled"
                ? `w-3.5 h-3.5 rounded-full mt-1.5 ring-2 ring-[hsl(var(--color-status-settled)/0.35)] ${dotClassName}`
                : `w-2.5 h-2.5 rounded-full mt-2 ${dotClassName}`
            }
            aria-hidden="true"
          />
        )}
        {!hideConnector && (
          <span
            className={`flex-1 w-0 mt-0.5 ${dashed ? "border-l border-dashed border-[hsl(var(--color-hairline-strong))]" : "border-l border-[hsl(var(--color-hairline))]"}`}
          />
        )}
      </div>
      <div className="flex-1 min-w-0 py-1.5">{children}</div>
      {right && <div className="shrink-0 text-right py-1.5 pl-2">{right}</div>}
    </div>
  );
}

interface SoulLifecycleTimelineProps {
  soul: Soul;
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  events: SoulEvent[];
  ledgerRecords: LedgerRecord[];
  onOpenJudgmentQueue: (judgmentId: string) => void;
}

/**
 * Stage 3 "灵魂账页" — the single reverse-chronological spine that replaces
 * the four stacked judgment/disposition/reincarnation/event-log boxes (each
 * of which used to render its own "暂无记录" empty state independently of
 * the others). See docs/design-handoff/BRIEF.md §4.1 for the defect this
 * fixes and the Stage 3 design doc for the row/column spec implemented here.
 */
export function SoulLifecycleTimeline({
  soul,
  judgments,
  dispositions,
  reincarnations,
  events,
  ledgerRecords,
  onOpenJudgmentQueue,
}: SoulLifecycleTimelineProps) {
  const { t } = useI18n();
  const tf = tfFactory(t);
  const [tab, setTab] = useState<SpineTab>("all");
  const [includeSystemEvents, setIncludeSystemEvents] = useState(false);
  const [expandedSystemGroups, setExpandedSystemGroups] = useState<Record<string, boolean>>({});

  const hasReincarnated = reincarnations.length > 0;
  const currentPos = currentStepPosition(soul.current_state, hasReincarnated);
  const isSettled = soul.current_state === "SETTLED";

  // The row for the disposition that actually closed the account — the
  // "spine terminal" (see RowShell.terminalVariant above). Only SETTLED
  // souls get one; a SETTLED soul has one closing disposition, so the most
  // recently executed one is it.
  const terminalDisposition = useMemo(() => {
    if (!isSettled) return null;
    const executed = dispositions.filter((d) => d.is_executed);
    if (executed.length === 0) return null;
    return executed.reduce((latest, d) =>
      new Date(d.executed_at ?? d.created_at).getTime() > new Date(latest.executed_at ?? latest.created_at).getTime() ? d : latest
    );
  }, [isSettled, dispositions]);

  // EG_DEVOURER is the one realm_code DispositionService routes a failed
  // Egyptian soul to (backend/apps/disposition/services.py) — Ammit's realm,
  // annihilation rather than a destination. Neither Disposition nor Realm
  // carries a dedicated "nobody survives this" flag today, so this reads the
  // one concrete signal that exists rather than inventing a new field for a
  // purely presentational distinction.
  const isAnnihilated = terminalDisposition?.realm_code === "EG_DEVOURER";

  const openJudgment = useMemo(() => judgments.find((j) => !j.is_final), [judgments]);

  const stageLabels: Record<FutureStageKey, { title: string; hint: string }> = {
    JUDGING: {
      title: tf("souls.detail.timeline.stage_judging", "审判"),
      hint: tf("souls.detail.timeline.stage_judging_hint", "尚未开始 · 灵魂身故后进入审判队列"),
    },
    DISPOSED: {
      title: tf("souls.detail.timeline.stage_disposed", "处置"),
      hint: tf("souls.detail.timeline.stage_disposed_hint", "尚未开始 · 裁决后按判定结果分配去向"),
    },
    REINCARNATING: {
      title: tf("souls.detail.timeline.stage_reincarnating", "轮回"),
      hint: tf("souls.detail.timeline.stage_reincarnating_hint", "尚未开始 · 需先完成处置"),
    },
    NEXT_LIFE: {
      title: tf("souls.detail.timeline.stage_next_life", "下一世"),
      hint: tf("souls.detail.timeline.stage_next_life_hint", "待处置与轮回完成后确定"),
    },
  };

  const rows: SpineRow[] = useMemo(() => {
    const out: SpineRow[] = [];
    out.push(...buildKarmaRows(ledgerRecords));

    const birth = buildBirthMarker(soul, tf("souls.detail.timeline.born", "生于 {{location}}", { location: soul.origin_location || "—" }));
    if (birth) out.push(birth);
    const death = buildDeathMarker(soul, tf("souls.detail.timeline.died", "身故"));
    if (death) out.push(death);

    out.push(
      ...buildJudgmentMarkers(judgments, {
        entered: (court) => tf("souls.detail.timeline.entered_judgment", "进入审判{{court}}", { court: court ? ` · ${court}` : "" }),
        verdict: (verdict) =>
          tf("souls.detail.timeline.verdict", "裁决 · {{verdict}}", {
            verdict: tf(`souls.detail.verdict_${verdict.toLowerCase()}`, verdict),
          }),
      })
    );

    out.push(
      ...buildDispositionMarkers(dispositions, {
        executed: (realm) => tf("souls.detail.timeline.disposed", "处置执行 · {{realm}}", { realm: realm || t("souls.detail.destination") }),
        eternal: t("souls.detail.eternal"),
        memoryReset: (years) => `${t("souls.detail.memory_reset")}: ${years}`,
      })
    );

    out.push(
      ...buildReincarnationMarkers(reincarnations, {
        reborn: (name) => tf("souls.detail.timeline.reborn", "转生为 {{name}}", { name }),
        cycle: (n, realm) => `${t("souls.detail.cycle")} ${n} · ${realm}`,
      })
    );

    if (includeSystemEvents) out.push(...buildSystemRows(events));

    const futureStages = computeFutureStages(soul.current_state).filter(
      (s) => !(s === "JUDGING" && soul.current_state === "JUDGING")
    );
    out.push(...buildFutureRows(futureStages, stageLabels));

    if (soul.current_state === "JUDGING" && openJudgment) {
      out.push(
        buildActionRow(
          tf("souls.detail.timeline.awaiting_judgment", "审判 · 等待裁决"),
          tf("souls.detail.timeline.awaiting_judgment_hint", "灵魂正在审判队列中，等待裁决")
        )
      );
    }

    out.push(...buildCycleBandRows(soul, reincarnations, (n) => tf("souls.detail.timeline.cycle_band", "第 {{n}} 世", { n: String(n) })));

    return sortRows(out);
  }, [soul, judgments, dispositions, reincarnations, events, ledgerRecords, includeSystemEvents, openJudgment]);

  const visibleRows = filterRows(rows, tab, includeSystemEvents);

  return (
    <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
      {/* Header + filter tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase">
          {tf("souls.detail.timeline.title", "灵魂账页")}
        </h2>
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "karma", "judgment"] as SpineTab[]).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                tab === tabKey
                  ? "bg-[hsl(var(--color-accent))] text-black font-medium"
                  : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {tabKey === "all"
                ? tf("souls.detail.timeline.tab_all", "全部")
                : tabKey === "karma"
                  ? tf("souls.detail.timeline.tab_karma", "仅业力")
                  : tf("souls.detail.timeline.tab_judgment", "仅裁决")}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--color-ink-muted))] ml-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSystemEvents}
              onChange={(e) => setIncludeSystemEvents(e.target.checked)}
              className="accent-[hsl(var(--color-accent))]"
            />
            {tf("souls.detail.timeline.tab_system", "含系统事件")}
          </label>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center mb-5 overflow-x-auto">
        {PIPELINE_STEPS.map((step, i) => {
          const state = i < currentPos ? "done" : i === currentPos ? "now" : "future";
          const label =
            step === "ALIVE" || step === "ALIVE_NEXT"
              ? t("souls.states.ALIVE")
              : t(`souls.states.${step}`);
          return (
            <div key={step} className="flex items-center flex-1 min-w-[72px]">
              <div
                className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap text-center flex-1 ${
                  state === "now"
                    ? "bg-[hsl(var(--color-accent))] text-black"
                    : state === "done"
                      ? "text-[hsl(var(--color-ink-muted))]"
                      : "text-[hsl(var(--color-ink-subtle))] border border-dashed border-[hsl(var(--color-hairline-strong))]"
                }`}
              >
                {label}
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className={`h-px flex-1 min-w-[8px] ${
                    i < currentPos ? "bg-[hsl(var(--color-ink-muted))]" : "border-t border-dashed border-[hsl(var(--color-hairline-strong))]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Spine */}
      <div>
        {visibleRows.length === 0 ? (
          <p className="text-[hsl(var(--color-ink-subtle))] text-sm text-center py-4">
            {tf("souls.detail.timeline.empty", "没有符合筛选条件的记录")}
          </p>
        ) : (
          visibleRows.map((row, idx) => {
            const isLast = idx === visibleRows.length - 1;
            if (row.kind === "karma") {
              const positive = row.effectiveSigned >= 0;
              return (
                <RowShell
                  key={row.id}
                  date={row.dateLabel}
                  hideConnector={isLast}
                  tint={row.isMilestone}
                  dotClassName={row.type === "MERIT" ? TONE_DOT.merit : TONE_DOT.demerit}
                  right={
                    <div>
                      <div className={`text-sm font-semibold ${positive ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"}`}>
                        {positive ? "+" : ""}
                        {row.effectiveSigned}
                      </div>
                      <div className="text-[10px] text-[hsl(var(--color-ink-subtle))]">
                        ×{row.decayFactor.toFixed(3)} · {row.yearsElapsed.toFixed(1)} {tf("souls.detail.timeline.years", "年")}
                      </div>
                    </div>
                  }
                >
                  <div className="text-sm text-[hsl(var(--color-ink))] truncate">
                    {row.isMilestone && <span className="text-[hsl(var(--color-accent))]">★ </span>}
                    {row.title}
                  </div>
                  <div className="text-xs text-[hsl(var(--color-ink-muted))] truncate">
                    {row.type === "MERIT" ? t("souls.detail.merit") : t("souls.detail.demerit")} ·{" "}
                    {tf(`souls.categories.${row.category_code}`, row.category_code)} {row.category_code} ·{" "}
                    {tf("souls.detail.timeline.original", "原始 {{sign}}{{n}}", {
                      sign: row.originalSigned >= 0 ? "+" : "",
                      n: String(row.originalSigned),
                    })}
                  </div>
                </RowShell>
              );
            }

            if (row.kind === "marker") {
              const isTerminalRow = isSettled && terminalDisposition !== null && row.id === `disposition-${terminalDisposition.id}`;
              return (
                <RowShell
                  key={row.id}
                  date={row.dateLabel}
                  hideConnector={isLast}
                  dotClassName={isTerminalRow ? "bg-[hsl(var(--color-status-settled))]" : TONE_DOT[row.tone]}
                  terminalVariant={isTerminalRow ? (isAnnihilated ? "flush" : "filled") : undefined}
                >
                  <div className="text-sm text-[hsl(var(--color-ink))] truncate">{row.title}</div>
                  {row.metadata && <div className="text-xs text-[hsl(var(--color-ink-muted))] truncate">{row.metadata}</div>}
                  {isTerminalRow && (
                    <div
                      className={`text-[10px] font-mono mt-0.5 ${isAnnihilated ? "text-[hsl(var(--color-ink-tertiary))]" : "text-[hsl(var(--color-ink-muted))]"}`}
                    >
                      {isAnnihilated
                        ? tf("souls.detail.timeline.terminal_flush", "── 其人已无")
                        : tf("souls.detail.timeline.terminal_filled", "◉ 尚有其人")}
                    </div>
                  )}
                  {row.idChip && (
                    <span className="inline-block mt-0.5 font-mono text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-subtle))]">
                      {row.idChip.slice(0, 8)}
                    </span>
                  )}
                </RowShell>
              );
            }

            if (row.kind === "system") {
              const isOpen = expandedSystemGroups[row.id] ?? false;
              return (
                <RowShell key={row.id} date={row.dateLabel} hideConnector={isLast} dotClassName={TONE_DOT.neutral}>
                  <button
                    type="button"
                    onClick={() => setExpandedSystemGroups((s) => ({ ...s, [row.id]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="text-left w-full"
                  >
                    <div className="text-xs text-[hsl(var(--color-ink-muted))]">
                      {row.title}
                      {row.count > 1 && ` ×${row.count}`} · {row.actor}
                      {row.count > 1 && (
                        <span className="ml-1 text-[hsl(var(--color-ink-subtle))]">
                          {isOpen ? "▲" : `▼ ${tf("souls.detail.timeline.expand", "展开")}`}
                        </span>
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-1 space-y-0.5 pl-2 border-l border-[hsl(var(--color-hairline))]">
                      {row.items.map((item) => (
                        <div key={item.id} className="text-[10px] text-[hsl(var(--color-ink-subtle))] font-mono truncate">
                          {describeSystemEvent(item)}
                        </div>
                      ))}
                    </div>
                  )}
                </RowShell>
              );
            }

            if (row.kind === "action") {
              return (
                <RowShell key={row.id} date={null} hideConnector={isLast} dotClassName={TONE_DOT.accent} highlight>
                  <div className="text-sm font-medium text-[hsl(var(--color-ink))]">{row.title}</div>
                  <div className="text-xs text-[hsl(var(--color-ink-muted))] mb-2">{row.hint}</div>
                  <RequirePermission permissions="judgment.create">
                    <button
                      type="button"
                      onClick={() => openJudgment && onOpenJudgmentQueue(openJudgment.id)}
                      className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded-md text-xs font-medium transition-colors"
                    >
                      {tf("souls.detail.timeline.open_in_queue", "在审判队列中打开")}
                    </button>
                  </RequirePermission>
                </RowShell>
              );
            }

            if (row.kind === "future") {
              return (
                <RowShell key={row.id} date={null} hideConnector={isLast} dashed dotClassName="bg-[hsl(var(--color-surface-3))] border border-dashed border-[hsl(var(--color-hairline-strong))]">
                  <div className="text-sm text-[hsl(var(--color-ink-subtle))]">{row.title}</div>
                  <div className="text-xs text-[hsl(var(--color-ink-subtle))]">{row.hint}</div>
                </RowShell>
              );
            }

            // cycle-band divider
            return (
              <div key={row.id} className="my-2 pl-16">
                <div className="flex items-center gap-2 py-1 px-2 rounded bg-[hsl(var(--color-surface-2))] text-[11px] text-[hsl(var(--color-ink-muted))]">
                  <span className="font-semibold text-[hsl(var(--color-ink))]">
                    {tf("souls.detail.timeline.cycle_band", "第 {{n}} 世", { n: String(row.cycleNumber) })}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{row.name}</span>
                  {row.form && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{row.form}</span>
                    </>
                  )}
                  {row.isCurrent && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t(`souls.states.${soul.current_state}`)}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
