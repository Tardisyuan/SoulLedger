"use client";

import type { Disposition, Judgment, Reincarnation, SoulEvent } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { verdictGlyph, verdictInk } from "@/src/lib/verdictGlyph";
import { latest } from "./soulProgress";

/**
 * 区块标:天干序号 + 名称(+ 条数),mono 2xs,压在区块边界线上(规范 v1 灵魂详情)。
 * 天干是账簿的编号法,与 01…04 同类,所以不进语言包;名称进。
 * `columns` 给表头时,标与列名同一行(393 px 下标独占一行)。
 */
export function LedgerHeading({
  mark,
  title,
  count,
  columns,
  id,
}: {
  mark?: string;
  title: string;
  count?: number;
  columns?: React.ReactNode;
  id?: string;
}) {
  return (
    <h2
      id={id}
      className={`font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pt-6 pb-1 border-b border-[oklch(var(--color-block))] ${
        columns ? "grid grid-cols-[6rem_1fr_1fr_5rem] max-sm:grid-cols-[5rem_1fr_1fr_3.5rem] gap-x-2" : ""
      }`}
    >
      <span className={columns ? "max-sm:col-span-full max-sm:pb-1" : undefined}>
        {mark && <span aria-hidden="true">{mark} · </span>}
        {title}
        {count !== undefined && ` ${count}`}
      </span>
      {columns}
    </h2>
  );
}

/** 一条账行:四列,行线分隔。与 `LedgerHeading` 的列宽同一份。 */
const ROW = "grid grid-cols-[6rem_1fr_1fr_5rem] max-sm:grid-cols-[5rem_1fr_1fr_3.5rem] gap-x-2";
const CELL = "py-1.5 border-b border-[oklch(var(--color-rule))] min-w-0";
const TIME = `${CELL} font-mono text-xs`;

/**
 * 丙 审判 / 丁 处置 / 戊 轮回 / 己 事件日志 —— 四张平账,行线代替卡片。
 * 条目按时间倒序,与下面的「灵魂账页」同向。
 */
export function SoulLedgerSections({
  judgments,
  dispositions,
  reincarnations,
  events,
}: {
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  events: SoulEvent[];
}) {
  const { t, formatDate, formatDateTime } = useI18n();
  const byNewest = <T,>(items: T[], at: (x: T) => string | null | undefined) =>
    [...items].sort((a, b) => (at(b) ?? "").localeCompare(at(a) ?? ""));

  // 判词:最近一份**已宣判且写了判词**的判决。判词是 `notes` —— 判官结案时写下的那段话。
  const quoted = latest(
    judgments.filter((j) => j.is_final && (j.notes ?? "").trim()),
    (j) => j.concluded_at ?? j.created_at
  );
  const signature = quoted ? [quoted.court, quoted.judge_name].filter(Boolean).join(" ") : "";

  const head = (...cols: React.ReactNode[]) =>
    cols.map((c, i) => (
      <span key={i} className={i === cols.length - 1 ? "text-right" : undefined}>
        {c}
      </span>
    ));

  return (
    <div data-testid="soul-ledger-sections">
      <LedgerHeading
        mark="丙"
        title={t("souls.detail.timeline.stage_judging")}
        count={judgments.length}
        columns={head(t("souls.detail.ledger.court_judge"), "", t("judgment.verdict"))}
      />
      {byNewest(judgments, (j) => j.concluded_at ?? j.created_at).map((j) => {
        const bench = [j.court, j.judge_name].filter(Boolean).join(" · ");
        return (
        <div key={j.id} className={ROW} data-testid="ledger-judgment-row">
          <span className={TIME}>{formatDate(j.concluded_at ?? j.created_at)}</span>
          <span title={bench || undefined} className={`${CELL} col-span-2 truncate`}>
            {bench || <MissingValue kind="unrecorded" />}
          </span>
          <span className={`${CELL} text-right ${verdictInk(j.verdict)}`}>
            {j.verdict ? (
              <>
                <span aria-hidden="true">{verdictGlyph(j.verdict)} </span>
                <DomainEnum namespace="judgment.verdicts" value={j.verdict} />
              </>
            ) : (
              t("souls.detail.ledger.verdict_pending")
            )}
          </span>
        </div>
        );
      })}
      {quoted && (
        <div className="py-4 border-b border-[oklch(var(--color-rule))] grid md:grid-cols-[5rem_1fr] gap-x-4 gap-y-1.5">
          <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))] pt-1">
            {t("souls.detail.ledger.verdict_words")}
          </span>
          <figure className="max-w-[72ch]">
            {/* 全页唯一的衬线(规范 v1 §1.4:20/32 只给引文)。 */}
            <blockquote
              data-testid="soul-verdict-quote"
              className="pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-quote text-[oklch(var(--color-ink))] text-pretty"
            >
              {quoted.notes}
            </blockquote>
            {signature && (
              <figcaption className="pl-4 mt-1 text-xs text-[oklch(var(--color-ink-muted))]">— {signature}</figcaption>
            )}
          </figure>
        </div>
      )}

      <LedgerHeading
        mark="丁"
        title={t("souls.detail.timeline.stage_disposed")}
        count={dispositions.length}
        columns={head(
          t("souls.detail.destination"),
          t("souls.detail.ledger.nature"),
          t("souls.detail.ledger.executed")
        )}
      />
      {byNewest(dispositions, (d) => d.created_at).map((d) => (
        <div key={d.id} className={ROW} data-testid="ledger-disposition-row">
          <span className={TIME}>{formatDate(d.created_at)}</span>
          <span title={d.realm_name || d.realm_code || undefined} className={`${CELL} truncate`}>
            {d.realm_name || d.realm_code || <MissingValue kind="unrecorded" />}
          </span>
          <span className={CELL}>
            {d.is_eternal ? t("souls.detail.eternal") : t("souls.detail.ledger.non_eternal")}
            {!d.is_eternal && d.sentence_years ? ` · ${d.sentence_years} ${t("souls.detail.timeline.years")}` : ""}
          </span>
          <span className={`${TIME} text-right`}>
            {d.executed_at ? formatDate(d.executed_at) : (
              <span className="font-sans text-[oklch(var(--color-ink-subtle))]">{t("souls.detail.ledger.not_executed")}</span>
            )}
          </span>
        </div>
      ))}

      <LedgerHeading
        mark="戊"
        title={t("souls.detail.timeline.stage_reincarnating")}
        count={reincarnations.length}
        columns={reincarnations.length ? head(
          t("souls.detail.ledger.new_identity"),
          t("reincarnation.form_label"),
          t("souls.detail.cycle")
        ) : undefined}
      />
      {reincarnations.length === 0 ? (
        <p className="mt-2 border border-dashed border-[oklch(var(--color-line-strong))] px-3 py-2 text-[oklch(var(--color-ink-muted))]">
          <b className="font-medium text-[oklch(var(--color-ink))]">{t("souls.detail.ledger.not_yet")}</b>
          {" · "}
          {t("souls.detail.timeline.stage_reincarnating_hint")}
        </p>
      ) : (
        byNewest(reincarnations, (r) => r.reincarnated_at).map((r) => (
          <div key={r.id} className={ROW} data-testid="ledger-reincarnation-row">
            <span className={TIME}>{formatDate(r.reincarnated_at)}</span>
            <span title={r.new_identity || undefined} className={`${CELL} truncate`}>{r.new_identity || <MissingValue kind="unrecorded" />}</span>
            <span className={CELL}>
              <DomainEnum namespace="reincarnation.forms" value={r.rebirth_form} />
            </span>
            <span className={`${TIME} text-right`}>{r.cycle_count}</span>
          </div>
        ))
      )}

      <LedgerHeading mark="己" title={t("souls.detail.ledger.events")} count={events.length} />
      {/* 规范稿在宽屏第三列印出原始枚举(DISPOSITION_EXECUTED);这里不印 ——
          BRIEF §4.6:原始成员只进 `title`,DomainEnum 已经放在那里了。 */}
      <div className="grid grid-cols-[10rem_1fr] max-sm:grid-cols-[8rem_1fr] gap-x-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
        {byNewest(events, (e) => e.create_time).map((e) => (
          <div key={e.id} className="contents" data-testid="ledger-event-row">
            <span className={CELL}>{formatDateTime(e.create_time)}</span>
            <span className={`${CELL} font-sans text-[oklch(var(--color-ink))]`}>
              <DomainEnum namespace="souls.events" value={e.event_type} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
