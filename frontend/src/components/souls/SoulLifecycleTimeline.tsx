"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { RowShell, TONE_DOT } from "@/src/components/souls/SoulLifecycleRowShell";
import { ANNIHILATION_REALM_CODE } from "@/src/lib/realmCodes";
import type { Soul } from "@soulledger/core/api/souls";
import type { SoulEvent } from "@soulledger/core/api/events";
import type { Judgment } from "@soulledger/core/api/judgment";
import type { Disposition } from "@soulledger/core/api/disposition";
import type { Reincarnation } from "@soulledger/core/api/reincarnation";
import type { LedgerRecord } from "@soulledger/core/api/ledger";
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
  makeSystemEventLabels,
  type SpineTab,
  type SpineRow,
  type FutureStageKey,
} from "./soulLifecycleRows";

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
  // `tf` comes from the context, not from a copy of the helper declared here.
  // It is memoised on `t` at its single definition site (I18nContext's
  // `const tf = useMemo(() => makeTranslateWithFallback(t), [t])`), which is
  // the property the `stageLabels` and `rows` memos below depend on: a fresh
  // closure every render would make both recompute every render — i.e.
  // memoise nothing. This file used to build its own; so did
  // SoulKarmaLedgerCard, and so did the page above them before `b3a3e7c`.
  const { t, tf } = useI18n();
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

  // ANNIHILATION_REALM_CODE is the one realm_code DispositionService routes a
  // failed Egyptian soul to (backend/apps/disposition/services.py) —
  // annihilation rather than a destination. Neither Disposition nor Realm
  // carries a dedicated "nobody survives this" flag today, so this reads the
  // one concrete signal that exists rather than inventing a new field for a
  // purely presentational distinction.
  //
  // The literal deliberately lives in src/lib/realmCodes.ts and not here: it
  // is a backend identifier, and it was hard-coded at this line until the
  // EG_DEVOURER -> EG_ANNIHILATION rename. A backend-only rename would have
  // stopped this branch matching without failing anything. See that file, and
  // backend/tests/test_annihilation_realm_code.py, which compares the two
  // sides.
  const isAnnihilated = terminalDisposition?.realm_code === ANNIHILATION_REALM_CODE;

  const openJudgment = useMemo(() => judgments.find((j) => !j.is_final), [judgments]);

  // Same reason as `tf` above: this is read by the `rows` memo, and an object
  // literal rebuilt every render would defeat it. It is copy keyed off `tf`
  // and nothing else, so `[tf]` is the whole of it.
  const stageLabels: Record<FutureStageKey, { title: string; hint: string }> = useMemo(() => ({
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
  }), [tf]);

  // Built once and threaded into both the row builder and the expanded-detail
  // render below, so the collapsed summary and the rows underneath it cannot
  // resolve the same enum two different ways.
  const systemEventLabels = useMemo(() => makeSystemEventLabels(t), [t]);

  const rows: SpineRow[] = useMemo(() => {
    const out: SpineRow[] = [];
    out.push(...buildKarmaRows(ledgerRecords));

    // "生于 —" read as a birthplace named after a dash. With no recorded
    // origin the clause is dropped entirely rather than filled with a
    // placeholder (BRIEF §4.6).
    const birth = buildBirthMarker(
      soul,
      soul.origin_location
        ? tf("souls.detail.timeline.born", "生于 {{location}}", { location: soul.origin_location })
        : tf("souls.detail.timeline.born_unknown_place", "出生")
    );
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

    if (includeSystemEvents) out.push(...buildSystemRows(events, systemEventLabels));

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
    // `t`, `tf` and `stageLabels` are every string this builder produces, and
    // they were all missing. The consequence was not hypothetical: switch
    // language on a soul detail page and the timeline kept its old copy until
    // some *other* dep moved. All three now change identity only when `t`
    // does, because `tf` and `stageLabels` are memoised on it above — so this
    // recomputes on a language switch and on nothing else it did not already
    // recompute on.
  }, [soul, judgments, dispositions, reincarnations, events, ledgerRecords, includeSystemEvents, openJudgment, systemEventLabels, stageLabels, t, tf]);

  const visibleRows = filterRows(rows, tab, includeSystemEvents);

  return (
    <div className="bg-[hsl(var(--color-surface-1))] p-5 border border-[hsl(var(--color-hairline))]">
      {/* Header + filter tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-01 text-[hsl(var(--color-ink-muted))] uppercase">
          {tf("souls.detail.timeline.title", "灵魂账页")}
        </h2>
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "karma", "judgment"] as SpineTab[]).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={`px-2.5 py-1 text-03 transition-colors ${
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
          <label className="flex items-center gap-1.5 text-03 text-[hsl(var(--color-ink-muted))] ml-2 cursor-pointer select-none">
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
                className={`px-2 py-1 text-02 font-medium whitespace-nowrap text-center flex-1 ${
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
          <p className="text-[hsl(var(--color-ink-subtle))] text-04 text-center py-4">
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
                      <div className={`text-03 font-semibold ${positive ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"}`}>
                        {positive ? "+" : ""}
                        {row.effectiveSigned}
                      </div>
                      <div className="text-02 text-[hsl(var(--color-ink-subtle))]">
                        ×{row.decayFactor.toFixed(3)} · {row.yearsElapsed.toFixed(1)} {tf("souls.detail.timeline.years", "年")}
                      </div>
                    </div>
                  }
                >
                  <div className="text-03 text-[hsl(var(--color-ink))] truncate">
                    {row.isMilestone && <span className="text-[hsl(var(--color-accent-ink))]">★ </span>}
                    {row.title}
                  </div>
                  <div className="text-02 text-[hsl(var(--color-ink-muted))] truncate">
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
                  <div title={row.title} className="text-03 text-[hsl(var(--color-ink))] truncate">{row.title}</div>
                  {row.metadata && <div title={row.metadata} className="text-02 text-[hsl(var(--color-ink-muted))] truncate">{row.metadata}</div>}
                  {isTerminalRow && (
                    <div
                      className={`text-02 font-mono mt-0.5 ${isAnnihilated ? "text-[hsl(var(--color-ink-tertiary))]" : "text-[hsl(var(--color-ink-muted))]"}`}
                    >
                      {isAnnihilated
                        ? tf("souls.detail.timeline.terminal_flush", "── 其人已无")
                        : tf("souls.detail.timeline.terminal_filled", "◉ 尚有其人")}
                    </div>
                  )}
                  {row.idChip && (
                    <span className="inline-block mt-0.5 font-mono text-02 px-1 py-0.5 bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-subtle))]">
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
                    {/* `title` carries the raw event_type — the domainDisplay
                        convention: translated copy on screen, raw member
                        recoverable for triage, and never the other way round. */}
                    <div className="text-02 text-[hsl(var(--color-ink-muted))]" title={row.rawEventType}>
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
                      {row.items.map((item) => {
                        const described = describeSystemEvent(item, systemEventLabels);
                        return (
                        <div key={item.id} title={described} className="text-02 text-[hsl(var(--color-ink-subtle))] font-mono truncate">
                          {described}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </RowShell>
              );
            }

            if (row.kind === "action") {
              return (
                <RowShell key={row.id} date={null} hideConnector={isLast} dotClassName={TONE_DOT.accent} highlight>
                  <div className="text-03 font-medium text-[hsl(var(--color-ink))]">{row.title}</div>
                  <div className="text-02 text-[hsl(var(--color-ink-muted))] mb-2">{row.hint}</div>
                  <RequirePermission permissions="judgment.create">
                    <button
                      type="button"
                      onClick={() => openJudgment && onOpenJudgmentQueue(openJudgment.id)}
                      className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black text-03 font-medium transition-colors"
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
                  <div className="text-03 text-[hsl(var(--color-ink-subtle))]">{row.title}</div>
                  <div className="text-02 text-[hsl(var(--color-ink-subtle))]">{row.hint}</div>
                </RowShell>
              );
            }

            // cycle-band divider
            return (
              <div key={row.id} className="my-2 pl-16">
                <div className="flex items-center gap-2 py-1 px-2 bg-[hsl(var(--color-surface-2))] text-02 text-[hsl(var(--color-ink-muted))]">
                  <span className="font-semibold text-[hsl(var(--color-ink))]">
                    {tf("souls.detail.timeline.cycle_band", "第 {{n}} 世", { n: String(row.cycleNumber) })}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{row.name}</span>
                  {row.form && (
                    <>
                      <span aria-hidden="true">·</span>
                      {/* The six paths (六道) are stored as enum keys; fall
                          back to the raw key so a value the locale files
                          have not caught up with still reads as something. */}
                      <span>{tf(`reincarnation.forms.${row.form}`, row.form)}</span>
                    </>
                  )}
                  {row.isCurrent && (
                    <>
                      <span aria-hidden="true">·</span>
                      <DomainEnum namespace="souls.states" value={soul.current_state} />
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
