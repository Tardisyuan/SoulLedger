"use client"

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { DataTableColumn } from '@/components/ui/data-table'
import { MissingValue } from '@/src/components/ui/DomainValue'
import type { MissingKind } from '@/src/lib/domainDisplay'
import { Badge, BADGE_TONE_CLASSES } from '@/src/components/ui/Badge'
import { ActionsMenu, type OverflowMenuItem } from './ActionsMenu'

/**
 * Six column types, and nothing outside them (design doc "Stage 2 - Data
 * Grid & Components", §1). A column declares one of these; the type owns
 * alignment, typeface, width behaviour and how it renders nothing, so a
 * caller never hand-rolls className strings per cell again.
 *
 * The mono/sans split is the spine of the taxonomy: identifier/numeric/
 * timestamp are machine strings a migration changes (mono, muted ink);
 * text/enum are things a translator changes (sans, full ink).
 */
export type DataGridColumnType = 'identifier' | 'text' | 'enum' | 'numeric' | 'timestamp' | 'actions'

interface BaseColumnDef<T> {
  key: string
  header: ReactNode
  sortable?: boolean
  srOnlyHeader?: boolean
  /** `<col>` width, e.g. `"24ch"`. Declare against the widest locale. */
  width?: string
  /** Extra `<td>` classes for one-off cases the type doesn't cover. */
  className?: string
  /**
   * Which of the three missing semantics an empty cell in this column means
   * (src/lib/domainDisplay.ts). "unrecorded" is the common case — the fact
   * could exist and nothing has been written yet. Set "inapplicable" when the
   * column has no meaning for the rows it can hold, e.g. a karmic balance
   * against a soul whose cosmology does not net merit against demerit.
   *
   * A recorded zero is neither: a numeric column prints the digit.
   */
  missingKind?: Exclude<MissingKind, 'zero'>
  /** Context appended to the empty cell's tooltip, e.g. why it does not apply. */
  missingReason?: string
}

export interface IdentifierColumnDef<T> extends BaseColumnDef<T> {
  type: 'identifier'
  value: (row: T) => string | null | undefined
  /** Empty-state label. Defaults to an em dash at ink-tertiary. */
  emptyLabel?: string
}

export interface TextColumnDef<T> extends BaseColumnDef<T> {
  type: 'text'
  value: (row: T) => ReactNode
  emptyLabel?: string
}

export type EnumTone = 'neutral' | 'success' | 'warning' | 'error' | 'info'

export interface EnumValue {
  tone: EnumTone
  label: ReactNode
  glyph?: string
  title?: string
}

export interface EnumColumnDef<T> extends BaseColumnDef<T> {
  type: 'enum'
  /** An enum always has a value — §1's empty rule is "never empty", so this returns EnumValue, not EnumValue | null. */
  value: (row: T) => EnumValue
}

export interface NumericColumnDef<T> extends BaseColumnDef<T> {
  type: 'numeric'
  value: (row: T) => number | null | undefined
  format?: (n: number) => string
  /** Colors the value by sign, e.g. karma ledgers. Defaults to neutral ink. */
  tone?: (n: number) => 'success' | 'error' | 'neutral'
}

export interface TimestampColumnDef<T> extends BaseColumnDef<T> {
  type: 'timestamp'
  value: (row: T) => string | number | Date | null | undefined
  /** Locale-aware formatter — pass `formatDateTime` from useI18n(). */
  format: (value: string | number | Date) => string
  /**
   * Copy for an empty cell where the column has something better to say than
   * the convention's glyph ("never judged"). Optional since §4.6: omitting it
   * falls through to <MissingValue kind={missingKind}>, which is typed and
   * carries its own tooltip — strictly better than the bare dash the required
   * field used to invite.
   */
  emptyLabel?: string
}

export interface ActionItem<T> {
  key: string
  label: ReactNode
  onSelect: (row: T) => void
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** Omit the item for this row, e.g. no permission on it. */
  hidden?: boolean
}

export interface ActionsColumnDef<T> extends BaseColumnDef<T> {
  type: 'actions'
  /** One verb rendered inline before the overflow trigger. */
  primary?: (row: T) => { label: ReactNode; onSelect: () => void; disabled?: boolean } | null
  items: (row: T) => ActionItem<T>[]
  /** Accessible name for the "⋯" trigger, e.g. t('common.row_actions'). */
  menuLabel: string
}

export type DataGridColumn<T> =
  | IdentifierColumnDef<T>
  | TextColumnDef<T>
  | EnumColumnDef<T>
  | NumericColumnDef<T>
  | TimestampColumnDef<T>
  | ActionsColumnDef<T>

/** Identifier/text/enum/timestamp read left; numeric/actions read right — §1's Align column, fixed per type. */
export function columnAlign(type: DataGridColumnType): 'left' | 'right' {
  return type === 'numeric' || type === 'actions' ? 'right' : 'left'
}

/**
 * The grid's five tones, PROJECTED from `BADGE_TONE_CLASSES` — not restated.
 *
 * This table used to hold its own copy of the five strings, with
 * src/__tests__/Badge.test.tsx pinning the two copies byte-for-byte. That pin
 * was the interim measure: `Badge` was written to restate the strings so that
 * this edge could later be added without a cycle, and this is that edge. There
 * is now one table of colour strings in the app, in
 * `src/components/ui/Badge.tsx`, and this is a view onto the five of its six
 * tones the data grid uses. `accent` is deliberately not projected: it is an
 * identity marker at a 20% fill, and the AA measurements below are written for
 * the 10% status tints.
 *
 * `EnumBadge` no longer reads this map — `Badge` applies the tone. What the map
 * is now is the grid's tone ROSTER: which of Badge's six the grid may use, and
 * the subject the AA contract measures. The roster is tied back to what
 * actually renders by src/__tests__/Badge.test.tsx, which iterates these keys
 * and compares a cell built through `renderGridCell` against `<Badge tone=…>`
 * class for class. A roster nothing renders would be drift; this one is
 * projected from the source of truth and checked against the render path.
 *
 * Badge fills are capped at a 10% tint of the status token — NOT 16%.
 * The light-mode `--color-status-*` values were re-measured against a 10%
 * tint over the canvas (see app/globals.css `.light`, and the same note in
 * src/components/ui/Toast.tsx); a 16% tint of the error token drops to
 * 4.37:1, under the 4.5:1 AA floor for text. Still exported, and still an
 * object literal keyed by tone, so src/__tests__/dataGridToneContract.test.ts
 * measures exactly what the grid renders and holds new tones to it.
 */
export const ENUM_TONE_CLASSES: Record<EnumTone, string> = {
  neutral: BADGE_TONE_CLASSES.neutral,
  success: BADGE_TONE_CLASSES.success,
  warning: BADGE_TONE_CLASSES.warning,
  error: BADGE_TONE_CLASSES.error,
  info: BADGE_TONE_CLASSES.info,
}

const NUMERIC_TONE_CLASSES: Record<'success' | 'error' | 'neutral', string> = {
  success: 'text-[hsl(var(--color-status-success))]',
  error: 'text-[hsl(var(--color-status-error))]',
  neutral: 'text-[hsl(var(--color-ink))]',
}

/**
 * The grid's enum cell, now a thin call to the shared `Badge`.
 *
 * Nothing about the geometry is restated here — that is the point. What this
 * used to carry beyond Badge's own classes was `rounded` (a dead class:
 * borderRadius.DEFAULT is 0, so it emitted `border-radius: 0` and only made a
 * reader think a decision had been taken — Badge deliberately writes no radius
 * at all), `text-xs` (12px, the size `text-02` also is, minus the 0.04em
 * tracking short badge labels want), and a hand-written tone lookup. Badge
 * replaces the last two and drops the first, and adds the `whitespace-nowrap`
 * this one lacked and every hand-rolled badge in the app rediscovered on its
 * own.
 *
 * `title` still carries the raw enum member (IDENTIFIER_POLICY) — it goes to
 * Badge as an ordinary span attribute, so a localised label stays recoverable.
 */
export function EnumBadge({ value }: { value: EnumValue }) {
  return (
    <Badge tone={value.tone} glyph={value.glyph} title={value.title}>
      {value.label}
    </Badge>
  )
}

/**
 * Renders one `<td>`'s contents for a column, applying the type's face,
 * empty-state and truncation rules. DataGrid calls this once per cell so no
 * two migrated screens can drift on how an identifier or a timestamp reads.
 */
export function renderGridCell<T>(column: DataGridColumn<T>, row: T): ReactNode {
  /**
   * One empty-cell renderer for every type, so no column can invent its own
   * dash. `emptyLabel` still wins where a column has genuine copy to show
   * ("never judged"), but the fallback is the typed <MissingValue>, not a
   * literal — BRIEF §4.6 asked for "not recorded yet" and "not applicable" to
   * be distinguishable, and a per-case string literal cannot be.
   */
  const empty = (label?: string) =>
    label
      ? <span className={column.missingKind === 'inapplicable' ? 'text-[hsl(var(--color-ink-subtle))]' : 'text-[hsl(var(--color-ink-tertiary))]'}>{label}</span>
      : <MissingValue kind={column.missingKind ?? 'unrecorded'} reason={column.missingReason} />

  switch (column.type) {
    case 'identifier': {
      const value = column.value(row)
      if (!value) {
        return empty(column.emptyLabel)
      }
      return (
        <span
          className="font-mono text-[hsl(var(--color-ink-muted))] truncate block max-w-full"
          title={value}
        >
          {value}
        </span>
      )
    }
    case 'text': {
      const value = column.value(row)
      if (value === null || value === undefined || value === '') {
        return empty(column.emptyLabel)
      }
      // `title`,和站内其余截断同一个理由,只是这里的形状不同:`line-clamp-2`
      // 夹的是**两行之后**的内容,所以格子里连省略号之后那一段都读不到。
      // `identifier` 那一列早就带 title,`text` 这一列没有 —— 而它装的正是
      // 描述、理由、新身份这类长文本(`JudgmentQueueContext.tsx:122,271`、
      // `audit/page.tsx:150,172`、`permissionColumns.tsx:23` 都走它)。
      //
      // 全文一直在 DOM 里(`line-clamp` 是视觉属性),所以读屏和复制不受影响;
      // 缺的一直是有鼠标的人把它读完的办法。
      // 一行写完,不拆行 —— `truncatedValuesAreRecoverable.test.ts` 按行匹配
      // (它自己的表头写明了这个代价),拆开之后 `{value}` 落到下一行,这一处
      // 就从它的主体清单里消失了。实测:拆行版本下把 title 删掉,守卫依然绿。
      return <span title={String(value)} className="text-[hsl(var(--color-ink))] line-clamp-2">{value}</span>
    }
    case 'enum':
      return <EnumBadge value={column.value(row)} />
    case 'numeric': {
      const n = column.value(row)
      if (n === null || n === undefined) {
        // A missing value and a zero balance are different facts, and since
        // §4.6 they read differently: no digit here, a digit there.
        return <span className="font-mono tabular-nums">{empty()}</span>
      }
      const formatted = column.format ? column.format(n) : String(n)
      const tone = column.tone ? column.tone(n) : 'neutral'
      return <span className={cn('font-mono tabular-nums', NUMERIC_TONE_CLASSES[tone])}>{formatted}</span>
    }
    case 'timestamp': {
      const value = column.value(row)
      if (value === null || value === undefined || value === '') {
        return empty(column.emptyLabel)
      }
      return <span className="font-mono tabular-nums text-[hsl(var(--color-ink))] whitespace-nowrap">{column.format(value)}</span>
    }
    case 'actions': {
      const primary = column.primary?.(row) ?? null
      const items: OverflowMenuItem[] = column
        .items(row)
        .filter((item) => !item.hidden)
        .map((item) => ({
          key: item.key,
          label: item.label,
          onSelect: () => item.onSelect(row),
          tone: item.tone,
          disabled: item.disabled,
        }))
      // Column omitted entirely if the row grants no actions — §1's empty rule.
      if (!primary && items.length === 0) return null
      return <ActionsMenu primary={primary ?? undefined} items={items} menuLabel={column.menuLabel} />
    }
    default:
      return null
  }
}

/** Maps DataGridColumn metadata onto the header contract DataTable already knows how to render/sort. */
export function toDataTableColumn<T>(column: DataGridColumn<T>): DataTableColumn {
  return {
    key: column.key,
    header: column.header,
    sortable: column.type === 'actions' ? false : column.sortable,
    align: columnAlign(column.type),
    srOnlyHeader: column.type === 'actions' ? true : column.srOnlyHeader,
    width: column.width,
  }
}
