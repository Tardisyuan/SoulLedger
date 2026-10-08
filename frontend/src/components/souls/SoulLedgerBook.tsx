"use client";

import type React from "react";
import Link from "next/link";
import type { LedgerRecord } from "@soulledger/core/api/ledger";
import { RECORD_QUANTITIES } from "@soulledger/core/api/ledgerQuantities";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { formatHistoricalDate } from "@/lib/utils";

/**
 * 功过台账 —— 逐条账页。Stage 12 C2。
 *
 * WHY THIS COMPONENT EXISTS AT ALL. 《太微仙君功過格》 is a ruled account book:
 * a good deed is entered under 功, a bad one under 過, and the two are settled
 * against each other line by line (逐條銷算). The product had every part of that
 * except the lines. `SoulKarmaLedgerCard` receives `records` and draws five
 * sums plus a lifespan chart; the judgment queue draws three sums; the reading
 * panels draw one figure each. So an eight-hundred-year-old *per-entry* ledger
 * reached no screen as entries anywhere. This is the 條.
 *
 * WHY A `<table>` AND NOT `DataTable` OR A GRID OF DIVS.
 *   * `DataTable` cannot draw the vertical rules — and `components/ui/*` is not
 *     mine to change. It also renders its own `<Pagination>`
 *     (data-table.tsx:288), which is why `PageShell.pagination` must stay empty
 *     wherever it is used; that trap is avoided here by not using it.
 *   * A grid of divs would have to re-declare row/column semantics in ARIA that
 *     `<table>` gives for free. This is real tabular data with a real footer
 *     total, so `<thead>`/`<tbody>`/`<tfoot>` and `<th scope>` are the honest
 *     markup, and a screen reader announces the column when it reads a cell —
 *     which is what makes an *empty* 功 cell legible as "nothing under 功"
 *     rather than as a rendering fault.
 *   * `<colgroup>` states the fixed widths once instead of repeating them
 *     on every cell.
 *
 * THE VERTICAL RULES ARE THE ONE SET IN THE PRODUCT. They are the form of the
 * instrument, not decoration, so they are 1px `hairline` — the lightest weight
 * in the ladder, because they are also the most numerous marks on the page. No
 * other screen gets them; `/ledger` was examined for this treatment and refused
 * it, because its payload is soul counts rather than weight sums (see the note
 * at the head of app/ledger/page.tsx).
 */

/**
 * 七列。The date is 116px — 92px was the first draft and wrapped.
 * 条款 (index 3) is its own column from 768 up, as in the Design v3 功过记录 table
 * (用户 2026-10-02); below that it is hidden and the clause folds into 事目's second line.
 * To make room for it the others narrowed (条 64 → 48, 功 / 过 96 → 72, 销算余 112 → 88:
 * a six-character figure in 14px mono is ~50px). The soul page's middle column at 1440 is
 * ~604px; the old 640 floor already cut 销算余 off there, so the floor is now 600 and 事目
 * gets the rest (~112px at 1440).
 */
const COLUMN_WIDTHS = [48, 116, undefined, 96, 72, 72, 88] as const;
const CLAUSE_COLUMN = 3;
/** The clause column and its fold are the two halves of one breakpoint. */
const CLAUSE_COLUMN_ONLY = "max-md:hidden";
const CLAUSE_FOLD_ONLY = "md:hidden";

interface LedgerBookRow {
  record: LedgerRecord;
  /** 1-based, in settlement order — see `settlementOrder`. */
  n: number;
  /** 销算余 after this entry. */
  runningBalance: number;
}

/**
 * Entries oldest-first, with the running balance carried down them.
 *
 * THE SORT IS NOT COSMETIC AND MUST NOT BE DROPPED. `LedgerService
 * .get_ledger_summary` sends `soul.records.all().order_by("-recorded_at")` —
 * newest first (backend/apps/ledger/services.py:406). A running balance carried
 * down that array settles the ledger backwards through time: every intermediate
 * 销算余 would be the net of the entries *after* it rather than before it, and
 * only the last row — the earliest deed — would come out right. Nothing about
 * that reads as wrong on screen, because the arithmetic is internally
 * consistent; it is just answering a different question than the column header
 * asks.
 *
 * Sorted here rather than reversed, so this holds whatever order the array
 * arrives in. `recorded_at` is the key and not `event_date`, because an account
 * book settles in the order entries were *booked*: `event_date` is when the
 * deed happened and is nullable for ancient souls, so ordering by it would both
 * reshuffle entries against the order the backend's decay anchor uses and put
 * the undated ones nowhere in particular. `event_date` is what the 日 column
 * *shows*; `recorded_at` is what the book is kept in.
 */
export function settlementOrder(records: LedgerRecord[]): LedgerBookRow[] {
  const ordered = [...records].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  let running = 0;
  return ordered.map((record, i) => {
    running += record.type === "MERIT" ? record.original_weight : -record.original_weight;
    return { record, n: i + 1, runningBalance: running };
  });
}

/**
 * 功 / 过 use `original_weight` — the entry as it was written that day.
 *
 * `effective_weight` is the same deed after time decay, which is a lens over
 * the whole ledger rather than a fact about one line, and it is already drawn
 * as the decayed pair in the card above. Using the raw weight also makes this
 * table's footer reconcile with that card's 原始 功德 / 原始 罪业 by
 * construction: both are sums of `original_weight` over the same array. A
 * footer that cannot be tied to a figure already on the page is a total nobody
 * can check.
 */
function entryWeight(record: LedgerRecord): number {
  return record.original_weight;
}

/**
 * `'<Statute.code>:<条款原文>'` 的律条号那一半(`救濟門#7`);没有条款时退到律条快照的 code
 * (`statute_snapshot`,V5 的律条链接);两样都没记就是 null。
 */
export function clauseCode(record: LedgerRecord): string | null {
  const code = (record.statute_clause ?? "").split(":")[0].trim();
  return code || record.statute_snapshot?.code || null;
}

/** ClauseLink 的 title:条款全文,没有就是快照里引用那天的标题。 */
function clauseTitle(record: LedgerRecord, locale: string): string | undefined {
  if (record.statute_clause) return record.statute_clause;
  const snap = record.statute_snapshot;
  if (!snap) return undefined;
  return snap.title[locale === "zh-Hans" ? "zh" : locale] || snap.title.zh || snap.code;
}

/** 事目第二行有没有东西可写(次数 / 节点 / 人生阶段 / 证据来源)。两处共用,免得各自漏一项。 */
export function hasRecordFacts(record: LedgerRecord): boolean {
  return record.occurrence_count != null || record.is_milestone || !!record.life_stage || !!record.evidence_source;
}

/**
 * 条款号 → 语料页的那一条(`/corpus?code=<Statute.code>`,用户 2026-10-02);条款全文在 title。
 * 没有条款锚点:语料页不把 `payload_json.clauses` 画成可定位的元素,所以只落到条,不落到款。
 * 审判台证据行与灵魂详情台账共用。
 */
export function ClauseLink({ record, code, className, ...rest }: { record: LedgerRecord; code: string; className?: string } & Record<`data-${string}`, string>) {
  const { locale } = useI18n();
  return (
    <Link
      href={`/corpus?code=${encodeURIComponent(code)}`}
      title={clauseTitle(record, locale)}
      className={`underline decoration-dotted decoration-[oklch(var(--color-hairline))] underline-offset-2 hover:text-[oklch(var(--color-ink))] hover:decoration-current ${className ?? ""}`}
      {...rest}
    >
      {code}
    </Link>
  );
}

/**
 * 一条功过的「第二行」事实:发生次数与重要节点(Design v3 功过记录行:「发生 1 次 · ◆ 重要节点」)。
 * 次数没记(null)就不写 —— 不当 1 次;不是重要节点就不写。两样都没有时什么也不画。
 * 审判台的证据行与灵魂详情的台账共用这一份。
 */
export function RecordFacts({ record }: { record: LedgerRecord }) {
  const { t } = useI18n();
  const parts: React.ReactNode[] = [];
  if (record.occurrence_count != null) parts.push(t("ledger.book.occurrences", { n: String(record.occurrence_count) }));
  if (record.is_milestone) parts.push(`◆ ${t("ledger.book.milestone")}`);
  // V5:人生阶段与证据来源。枚举走 DomainEnum(原始成员在 title);来源备注在 title 里,不占行。
  if (record.life_stage) parts.push(<DomainEnum namespace="souls.life_stages" value={record.life_stage} />);
  if (record.evidence_source) {
    parts.push(
      <span title={record.evidence_note || undefined} data-evidence-source="">
        <DomainEnum namespace="souls.evidence_sources" value={record.evidence_source} />
      </span>
    );
  }
  if (parts.length === 0) return null;
  // Each fact is one unbreakable unit: 「◆」 never ends a line with 「重要节点」 on the next
  // (用户 2026-10-02). The line may still break between facts, at the 「 · 」.
  return (
    <span data-record-facts="">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </span>
  );
}

export interface SoulLedgerBookProps {
  records: LedgerRecord[];
}

export function SoulLedgerBook({ records }: SoulLedgerBookProps) {
  const { t, formatDate, locale } = useI18n();
  const rows = settlementOrder(records);

  const meritTotal = rows
    .filter((r) => r.record.type === "MERIT")
    .reduce((s, r) => s + entryWeight(r.record), 0);
  const demeritTotal = rows
    .filter((r) => r.record.type === "DEMERIT")
    .reduce((s, r) => s + entryWeight(r.record), 0);
  const netTotal = meritTotal - demeritTotal;

  if (rows.length === 0) {
    return (
      <section>
        <BookHeading title={t("ledger.book.title")} />
        <p className="text-sm text-[oklch(var(--color-ink-subtle))]">{t("ledger.book.empty")}</p>
      </section>
    );
  }

  return (
    <section>
      <BookHeading title={t("ledger.book.title")} />
      {/* 396px of fixed columns plus the entry column (492 with 条款 from 768 up);
          below 600 the book scrolls rather than crushing the numerals out of alignment —
          600, not 640, so the ~604px middle column of the soul page at 1440 holds all seven. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] table-fixed border-collapse">
          <colgroup>
            {COLUMN_WIDTHS.map((width, i) => (
              <col
                key={i}
                className={i === CLAUSE_COLUMN ? CLAUSE_COLUMN_ONLY : undefined}
                style={width === undefined ? undefined : { width }}
              />
            ))}
          </colgroup>

          <thead>
            <tr className="border-b border-[oklch(var(--color-hairline))]">
              <HeadCell first>{t("ledger.book.col_n")}</HeadCell>
              <HeadCell>{t("ledger.book.col_date")}</HeadCell>
              <HeadCell>{t("ledger.book.col_item")}</HeadCell>
              <HeadCell className={`${CLAUSE_COLUMN_ONLY} text-[oklch(var(--color-ink-subtle))]`}>
                {t("ledger.book.clause")}
              </HeadCell>
              {/* The two column heads and the +/− signs carry the polarity; every
                  numeral is ink, as on /ledger (Design E 组:冷玫红只表「失败」,
                  拿来标罪业就和失败状态撞了). The scale word rides the header ONCE per column — `Figure`
                  prints it beside every figure, which is right for a panel of
                  three numbers and wrong for a table of thirty. */}
              <HeadCell numeric scale className="text-[oklch(var(--color-ink))]">
                {t("ledger.book.col_merit")}
              </HeadCell>
              <HeadCell numeric scale className="text-[oklch(var(--color-ink))]">
                {t("ledger.book.col_demerit")}
              </HeadCell>
              <HeadCell numeric scale>{t("ledger.book.col_balance")}</HeadCell>
            </tr>
          </thead>

          <tbody>
            {rows.map(({ record, n, runningBalance }) => {
              const isMerit = record.type === "MERIT";
              const weight = entryWeight(record);
              const eventDate = formatHistoricalDate(record.event_date, locale);
              const clause = clauseCode(record);
              const hasFacts = hasRecordFacts(record);

              return (
                <tr key={record.id} className="border-b border-[oklch(var(--color-hairline))]">
                  <BodyCell first className="text-[oklch(var(--color-ink-tertiary))] tabular-nums font-mono">
                    {n}
                  </BodyCell>

                  {/* 116px and `whitespace-nowrap`: an ancient date reads
                      "44 BCE · March 15" and wrapping it puts the month on its
                      own line, which makes the column look like two rows. */}
                  <BodyCell className="font-mono text-xs text-[oklch(var(--color-ink-subtle))] whitespace-nowrap">
                    {eventDate ?? formatDate(record.recorded_at)}
                  </BodyCell>

                  {/* 事目 stays ink. Colouring the prose as well as the figure
                      would turn the page into a signal lamp and cost the two
                      numerals the only job the colour has. */}
                  <BodyCell className="font-sans text-sm text-[oklch(var(--color-ink-muted))]">
                    {record.description}
                    {/* 次数与重要节点在事目的第二行;条款在窄屏(< 768,没有条款列)也折进来。 */}
                    {(clause || hasFacts) && (
                      <span
                        className={`mt-0.5 block text-xs text-[oklch(var(--color-ink-subtle))] ${
                          hasFacts ? "" : CLAUSE_FOLD_ONLY
                        }`}
                      >
                        {clause && (
                          <span className={CLAUSE_FOLD_ONLY}>
                            <ClauseLink record={record} code={clause} data-record-clause="folded" className="font-serif" />
                            {hasFacts && " · "}
                          </span>
                        )}
                        <RecordFacts record={record} />
                      </span>
                    )}
                  </BodyCell>

                  {/* 条款列(Design v3 功过记录):律条号,全文在 title;没记写「未记录」。 */}
                  <BodyCell className={`${CLAUSE_COLUMN_ONLY} font-serif text-xs text-[oklch(var(--color-ink-muted))] break-words`}>
                    {clause ? (
                      <ClauseLink record={record} code={clause} data-record-clause="column" />
                    ) : (
                      <MissingValue kind="unrecorded" />
                    )}
                  </BodyCell>

                  {/* One of these two is empty, and the emptiness is the
                      record: a deed falls on one side of the book or the other,
                      never both and never neither. A `0` would assert that
                      nothing was earned; a `—` would assert that something was
                      earned and not written down. Both are claims this ledger
                      does not make, so the cell simply holds nothing. */}
                  <BodyCell numeric>
                    {isMerit ? (
                      <Amount
                        field="original_weight"
                        sign="+"
                        value={weight}
                        className="text-[oklch(var(--color-ink))]"
                      />
                    ) : null}
                  </BodyCell>
                  <BodyCell numeric>
                    {isMerit ? null : (
                      <Amount
                        field="original_weight"
                        sign="-"
                        value={weight}
                        className="text-[oklch(var(--color-ink))]"
                      />
                    )}
                  </BodyCell>

                  <BodyCell numeric>
                    <Amount
                      field="running_balance"
                      sign={runningBalance < 0 ? "-" : "+"}
                      value={Math.abs(runningBalance)}
                      className="text-[oklch(var(--color-ink))]"
                    />
                  </BodyCell>
                </tr>
              );
            })}
          </tbody>

          {/* 合计 once, at the foot, never per row. `border-t-3` is the second
              of the two 3px rules in the product and it is the same rule as the
              判决落印带: both mark a settlement. Per-row subtotals would compete
              with 销算余, which already IS the running subtotal. */}
          <tfoot>
            <tr className="border-t-3 border-[oklch(var(--color-ink))]">
              <FootCell first />
              <FootCell />
              <FootCell className="font-sans text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
                {t("ledger.book.total")}
              </FootCell>
              <FootCell className={CLAUSE_COLUMN_ONLY} />
              <FootCell numeric>
                <Amount
                  field="merit_total"
                  sign="+"
                  value={meritTotal}
                  className="text-[oklch(var(--color-ink))]"
                />
              </FootCell>
              <FootCell numeric>
                <Amount
                  field="demerit_total"
                  sign="-"
                  value={demeritTotal}
                  className="text-[oklch(var(--color-ink))]"
                />
              </FootCell>
              <FootCell numeric>
                <Amount
                  field="net_total"
                  sign={netTotal < 0 ? "-" : "+"}
                  value={Math.abs(netTotal)}
                  className="text-[oklch(var(--color-ink))]"
                />
              </FootCell>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function BookHeading({ title }: { title: string }) {
  return (
    <h2 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] border-b-2 border-[oklch(var(--color-ink-subtle))] pb-2 mb-3">
      {title}
    </h2>
  );
}

/**
 * The vertical rule lives on the cell's left edge, so `first` is the column
 * that does not get one — a rule on the outer edge would box the table and turn
 * six ruled columns into a bordered card.
 */
function rule(first?: boolean): string {
  return first ? "" : "border-l border-[oklch(var(--color-hairline))]";
}

function HeadCell({
  children,
  first,
  numeric,
  scale,
  className = "",
}: {
  children?: React.ReactNode;
  first?: boolean;
  numeric?: boolean;
  /** Print the weight scale under this column head — once, for the column. */
  scale?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <th
      scope="col"
      className={`text-2xs uppercase font-normal px-2 py-2 align-bottom ${
        numeric ? "text-right" : "text-left"
      } ${rule(first)} ${className || "text-[oklch(var(--color-ink-subtle))]"}`}
    >
      {children}
      {scale ? (
        <span data-quantity-scale="" className="block text-2xs font-normal text-[oklch(var(--color-ink-tertiary))]">
          {t("ledger.figure_scale_weight")}
        </span>
      ) : null}
    </th>
  );
}

function BodyCell({
  children,
  first,
  numeric,
  className = "",
}: {
  children?: React.ReactNode;
  first?: boolean;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 py-2 align-top ${numeric ? "text-right" : "text-left"} ${rule(
        first
      )} ${numeric && !children ? "text-[oklch(var(--color-ink-tertiary))]" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

function FootCell({
  children,
  first,
  numeric,
  className = "",
}: {
  children?: React.ReactNode;
  first?: boolean;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 py-3 align-top ${numeric ? "text-right" : "text-left"} ${rule(
        first
      )} ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * One figure in the book: the polarity symbol and the numeral, both in the
 * polarity's colour, and nothing else.
 *
 * `data-quantity` follows the convention `QuantityFigure` established, but the
 * scale marker deliberately does NOT ride the numeral here — it is on the
 * column head. Anyone wiring this component into `readingQuantityContract` /
 * `ledgerQuantityContract` should know that their `figures()` helpers look for
 * `[data-quantity-scale]` as a *sibling* of the numeral, which is the panel
 * layout; in a table the scale is stated once per column and those helpers
 * would report every figure here as unscaled.
 */
function Amount({
  field,
  sign,
  value,
  className,
}: {
  field: string;
  sign: "+" | "-";
  value: number;
  className: string;
}) {
  return (
    <span
      data-quantity={RECORD_QUANTITIES.original_weight}
      data-quantity-field={field}
      className={`font-mono text-sm tabular-nums ${className}`}
    >
      {sign}
      {value}
    </span>
  );
}
