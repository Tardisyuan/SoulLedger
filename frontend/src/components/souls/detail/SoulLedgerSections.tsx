"use client";

import type { Disposition, Judgment, Reincarnation, SoulEvent } from "@soulledger/core/api";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { VerdictBadge } from "@/src/components/ui/StatusBadge";
import { useTenant } from "@/src/contexts/TenantContext";
import { ROW_MARK_ROW, RowMark, isMinePending } from "@/src/components/judgment/RowMark";
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
      className={`text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pt-6 pb-1 border-b border-[oklch(var(--color-block))] ${
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
const CELL = "py-2 border-b border-[oklch(var(--color-rule))] min-w-0";
const TIME = `${CELL} font-mono text-xs`;

const byNewest = <T,>(items: T[], at: (x: T) => string | null | undefined) =>
  [...items].sort((a, b) => (at(b) ?? "").localeCompare(at(a) ?? ""));

/**
 * 「全部审判」(v3 灵魂详情账页的第一个标签):一行一份判决,约 40 px 高,时间倒序 ——
 * 日 · 庭与判官 · 裁决(字形 + 文字)· 查看。行首色标只在「未结案 + 认领人是我」的行上。
 * 下面是最近一份已宣判判决的判词,全页唯一的衬线(规范:衬线只给人说的话)。
 *
 * 行标题是原型的「第四世 · 初审」:世次读 `cycle`(0 是第一世),种类读 `kind`;
 * 下面一行小字是庭与判官 —— 都是判决自己带的。
 */
export function SoulJudgmentHistory({ judgments }: { judgments: Judgment[] }) {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();

  // 判词:最近一份**已宣判且写了判词**的判决。判词是 `notes` —— 判官结案时写下的那段话。
  const quoted = latest(
    judgments.filter((j) => j.is_final && (j.notes ?? "").trim()),
    (j) => j.concluded_at ?? j.created_at
  );
  const signature = quoted ? [quoted.court, quoted.judge_name].filter(Boolean).join(" ") : "";

  if (judgments.length === 0) {
    return <p className="px-4 py-6 text-sm text-[oklch(var(--color-ink-muted))]">{t("judgment.no_judgments")}</p>;
  }

  return (
    <div data-testid="soul-judgment-history">
      {byNewest(judgments, (j) => j.concluded_at ?? j.created_at).map((j) => {
        const bench = [j.court, j.judge_name].filter(Boolean).join(" · ");
        const mine = isMinePending(j, user?.id);
        return (
          <div
            key={j.id}
            className={`relative grid min-h-(--table-row-h) grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-[oklch(var(--color-line))] pl-4 pr-2 max-sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_auto] max-sm:gap-x-2 ${mine ? ROW_MARK_ROW : ""}`}
            data-testid="ledger-judgment-row"
          >
            {mine && <RowMark />}
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">
              {formatDate(j.concluded_at ?? j.created_at)}
            </span>
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-sm font-semibold text-[oklch(var(--color-ink))]" data-testid="judgment-life-kind">
                {j.cycle == null ? <MissingValue kind="unrecorded" /> : t("souls.detail.life_number", { n: String(j.cycle + 1) })}
                {" · "}
                <DomainEnum namespace="judgment.claim.kinds" value={j.kind} />
              </span>
              <span title={bench || undefined} className="block truncate text-xs text-[oklch(var(--color-ink-muted))]">
                {bench || <MissingValue kind="unrecorded" />}
              </span>
            </span>
            <span className="text-xs">
              {j.verdict ? <VerdictBadge verdict={j.verdict} /> : t("souls.detail.ledger.verdict_pending")}
            </span>
            <Link
              href={`/judgment/${j.id}`}
              className="inline-flex h-(--control-h-sm) items-center px-2 text-xs text-[oklch(var(--color-ink))] underline-offset-4 hover:underline"
            >
              {t("judgment.view")}
            </Link>
          </div>
        );
      })}
      {quoted && (
        <div className="grid gap-x-4 gap-y-2 px-4 py-4 md:grid-cols-[5rem_1fr]">
          <span className="pt-1 text-2xs text-[oklch(var(--color-ink-subtle))]">
            {t("souls.detail.ledger.verdict_words")}
          </span>
          <figure className="max-w-[72ch]">
            {/* 全页唯一的衬线(规范 v1 §1.4:20/32 只给引文)。 */}
            <blockquote
              data-testid="soul-verdict-quote"
              className="pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-md font-normal text-[oklch(var(--color-ink))] text-pretty"
            >
              {quoted.notes}
            </blockquote>
            {signature && (
              <figcaption className="pl-4 mt-1 text-xs text-[oklch(var(--color-ink-muted))]">— {signature}</figcaption>
            )}
          </figure>
        </div>
      )}
    </div>
  );
}

/**
 * 处置 / 轮回 / 事件日志 —— 三张平账,行线代替卡片,条目按时间倒序。
 * 审判搬进了账页的「全部审判」标签(`SoulJudgmentHistory`)。
 */
export function SoulLedgerSections({
  dispositions,
  reincarnations,
  events,
}: {
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  events: SoulEvent[];
}) {
  const { t, formatDate, formatDateTime } = useI18n();

  const head = (...cols: React.ReactNode[]) =>
    cols.map((c, i) => (
      <span key={i} className={i === cols.length - 1 ? "text-right" : undefined}>
        {c}
      </span>
    ));

  return (
    <div data-testid="soul-ledger-sections">
      <LedgerHeading
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

      <LedgerHeading title={t("souls.detail.ledger.events")} count={events.length} />
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
