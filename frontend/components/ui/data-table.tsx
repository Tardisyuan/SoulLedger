"use client"

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableSkeleton } from './skeleton'
import { Pagination } from '@/src/components/ui/Pagination'
import { useI18n } from '@/src/contexts/I18nContext'
import { cn } from '@/lib/utils'

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  /** Matches the `key` of the column being sorted. */
  key: string
  direction: SortDirection
}

/**
 * Parses DRF's `ordering` query param ("-created_at", "name") into the sort
 * shape DataTable expects. The leading "-" is DRF's descending marker, so this
 * has to stay in step with whatever the backend accepts.
 */
export function parseOrdering(ordering: string): SortState | null {
  if (!ordering) return null
  const desc = ordering.startsWith('-')
  return { key: desc ? ordering.slice(1) : ordering, direction: desc ? 'desc' : 'asc' }
}

export interface DataTableColumn {
  /**
   * Stable identifier for the column. When `sortable` is set this is also the
   * field name handed back through `onSortChange`, so it should match whatever
   * the API expects in its `ordering` param.
   */
  key: string
  header: React.ReactNode
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  /** Extra classes for the `<th>`; body cells stay caller-owned. */
  headerClassName?: string
  /**
   * Renders the header text for screen readers only. Use for action columns
   * where a visible label would just be noise.
   */
  srOnlyHeader?: boolean
}

export interface DataTableProps<T> {
  columns: DataTableColumn[]
  data?: T[]
  keyExtractor: (item: T, index: number) => string
  /** Returns the `<td>` cells for one row; the `<tr>` is supplied by the table. */
  renderRow: (item: T, index: number) => React.ReactNode
  /** Describes the table for screen readers. Rendered as an `sr-only` caption. */
  caption: string

  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  /** Overrides the default `common.error` copy. */
  errorMessage?: string
  skeletonRows?: number

  /** Controlled sort state. Sorting is server-side, so the caller owns this. */
  sort?: SortState | null
  onSortChange?: (next: SortState | null) => void

  /**
   * True when filters/search are active. Switches the empty state from "nothing
   * exists yet" to "nothing matched" — very different dead ends for the user.
   */
  isFiltered?: boolean
  emptyMessage?: string
  /** Primary action for the truly-empty case, e.g. a "create" button. */
  emptyAction?: React.ReactNode
  filteredEmptyMessage?: string
  onClearFilters?: () => void

  page?: number
  totalPages?: number
  totalCount?: number
  onPageChange?: (page: number) => void

  className?: string
}

const ALIGN_CLASS: Record<NonNullable<DataTableColumn['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/** none → asc → desc → none, so a third click clears sorting entirely. */
function nextSort(current: SortState | null | undefined, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: 'asc' }
  if (current.direction === 'asc') return { key, direction: 'desc' }
  return null
}

function SortIcon({ direction }: { direction?: SortDirection }) {
  const className = 'w-3.5 h-3.5 shrink-0'
  if (direction === 'asc') return <ArrowUp className={className} aria-hidden="true" />
  if (direction === 'desc') return <ArrowDown className={className} aria-hidden="true" />
  return (
    <ChevronsUpDown
      className={cn(className, 'opacity-40 group-hover:opacity-70 transition-opacity')}
      aria-hidden="true"
    />
  )
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  renderRow,
  caption,
  isLoading,
  isError,
  onRetry,
  errorMessage,
  skeletonRows = 5,
  sort,
  onSortChange,
  isFiltered,
  emptyMessage,
  emptyAction,
  filteredEmptyMessage,
  onClearFilters,
  page,
  totalPages,
  totalCount,
  onPageChange,
  className,
}: DataTableProps<T>) {
  const { t } = useI18n()

  const isEmpty = !isLoading && !isError && !data?.length
  const showPagination =
    !isLoading &&
    !isError &&
    page !== undefined &&
    totalPages !== undefined &&
    onPageChange !== undefined

  const handleSort = (column: DataTableColumn) => {
    if (!column.sortable || !onSortChange) return
    onSortChange(nextSort(sort, column.key))
  }

  const ariaSort = (column: DataTableColumn): React.AriaAttributes['aria-sort'] => {
    if (!column.sortable) return undefined
    if (sort?.key !== column.key) return 'none'
    return sort.direction === 'asc' ? 'ascending' : 'descending'
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="overflow-x-auto rounded-lg border border-[hsl(var(--color-hairline))]">
        <table className="w-full text-sm" aria-busy={isLoading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
            <tr className="border-b border-[hsl(var(--color-hairline))]">
              {columns.map((column) => {
                const align = ALIGN_CLASS[column.align ?? 'left']
                const isSortable = Boolean(column.sortable && onSortChange)
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort(column)}
                    className={cn(
                      'font-medium',
                      align,
                      isSortable ? 'p-0' : 'px-4 py-3',
                      column.headerClassName
                    )}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className={cn(
                          'group flex w-full items-center gap-1.5 px-4 py-3 font-medium',
                          'hover:text-[hsl(var(--color-ink))] transition-colors',
                          // Focus ring comes from the global :focus-visible rule
                          // in globals.css; a local one would double up on it.
                          sort?.key === column.key && 'text-[hsl(var(--color-accent))]',
                          column.align === 'right' && 'justify-end',
                          column.align === 'center' && 'justify-center'
                        )}
                      >
                        <span className={cn(column.srOnlyHeader && 'sr-only')}>{column.header}</span>
                        <SortIcon
                          direction={sort?.key === column.key ? sort.direction : undefined}
                        />
                      </button>
                    ) : (
                      <span className={cn(column.srOnlyHeader && 'sr-only')}>{column.header}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          {/* TableSkeleton emits bare <tr>s, so it has to be wrapped here. */}
          {isLoading && (
            <tbody>
              <TableSkeleton rows={skeletonRows} cols={columns.length} />
            </tbody>
          )}

          {isError && (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="text-[hsl(var(--color-status-error))]">
                    {errorMessage ?? t('common.error')}
                  </p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-3 text-sm text-[hsl(var(--color-accent))] hover:underline"
                    >
                      {t('common.retry')}
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          )}

          {isEmpty && (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="text-[hsl(var(--color-ink-subtle))]">
                    {isFiltered
                      ? (filteredEmptyMessage ?? t('table.no_results'))
                      : (emptyMessage ?? t('table.empty'))}
                  </p>
                  {isFiltered
                    ? onClearFilters && (
                        <button
                          type="button"
                          onClick={onClearFilters}
                          className="mt-3 text-sm text-[hsl(var(--color-accent))] hover:underline"
                        >
                          {t('filter.clear_all')}
                        </button>
                      )
                    : emptyAction && <div className="mt-4">{emptyAction}</div>}
                </td>
              </tr>
            </tbody>
          )}

          {!isLoading && !isError && !isEmpty && (
            <tbody>
              {data?.map((item, index) => (
                <tr
                  key={keyExtractor(item, index)}
                  className="border-b border-[hsl(var(--color-hairline))] last:border-0 hover:bg-[hsl(var(--color-surface-2))] transition-colors"
                >
                  {renderRow(item, index)}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {showPagination && (
        <Pagination
          page={page}
          totalPages={totalPages}
          count={totalCount ?? data?.length ?? 0}
          onPageChange={onPageChange}
        />
      )}
    </div>
  )
}
