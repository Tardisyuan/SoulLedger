"use client"

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { DataTableColumn } from '@/components/ui/data-table'
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
  /** "Not yet recorded" label, never a bare dash (§1's empty rule for this type). */
  emptyLabel: string
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
 * Badge fills are capped at a 10% tint of the status token — NOT 16%.
 * The light-mode `--color-status-*` values were re-measured against a 10%
 * tint over the canvas (see app/globals.css `.light`, and the same note in
 * src/components/ui/Toast.tsx); a 16% tint of the error token drops to
 * 4.37:1, under the 4.5:1 AA floor for text. Exported so
 * src/__tests__/dataGridToneContract.test.ts can hold new tones to it.
 */
export const ENUM_TONE_CLASSES: Record<EnumTone, string> = {
  neutral: 'bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] border-[hsl(var(--color-hairline-tertiary))]',
  success: 'bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.3)]',
  warning: 'bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.3)]',
  error: 'bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.3)]',
  info: 'bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))] border-[hsl(var(--color-status-info)/0.3)]',
}

const NUMERIC_TONE_CLASSES: Record<'success' | 'error' | 'neutral', string> = {
  success: 'text-[hsl(var(--color-status-success))]',
  error: 'text-[hsl(var(--color-status-error))]',
  neutral: 'text-[hsl(var(--color-ink))]',
}

export function EnumBadge({ value }: { value: EnumValue }) {
  return (
    <span
      title={value.title}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
        ENUM_TONE_CLASSES[value.tone]
      )}
    >
      {value.glyph && <span aria-hidden="true">{value.glyph}</span>}
      {value.label}
    </span>
  )
}

/**
 * Renders one `<td>`'s contents for a column, applying the type's face,
 * empty-state and truncation rules. DataGrid calls this once per cell so no
 * two migrated screens can drift on how an identifier or a timestamp reads.
 */
export function renderGridCell<T>(column: DataGridColumn<T>, row: T): ReactNode {
  switch (column.type) {
    case 'identifier': {
      const value = column.value(row)
      if (!value) {
        return <span className="text-[hsl(var(--color-ink-tertiary))]">{column.emptyLabel ?? '—'}</span>
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
        return <span className="text-[hsl(var(--color-ink-tertiary))]">{column.emptyLabel ?? '—'}</span>
      }
      return <span className="text-[hsl(var(--color-ink))] line-clamp-2">{value}</span>
    }
    case 'enum':
      return <EnumBadge value={column.value(row)} />
    case 'numeric': {
      const n = column.value(row)
      if (n === null || n === undefined) {
        // "—" is NOT 0 — a missing value and a zero balance are different facts.
        return <span className="font-mono tabular-nums text-[hsl(var(--color-ink-tertiary))]">—</span>
      }
      const formatted = column.format ? column.format(n) : String(n)
      const tone = column.tone ? column.tone(n) : 'neutral'
      return <span className={cn('font-mono tabular-nums', NUMERIC_TONE_CLASSES[tone])}>{formatted}</span>
    }
    case 'timestamp': {
      const value = column.value(row)
      if (value === null || value === undefined || value === '') {
        return <span className="text-[hsl(var(--color-ink-tertiary))]">{column.emptyLabel}</span>
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
