"use client"

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableSkeleton } from './skeleton'
import { Pagination } from '@/src/components/ui/Pagination'
import { useI18n } from '@/src/contexts/I18nContext'
import { cn } from '@/lib/utils'
import { useRowTransitions } from '@/src/hooks/useRowTransitions'

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
  /**
   * Fixed or minimum width for this column's `<col>`, e.g. `"24ch"` or
   * `"132px"`. Declaring these against the widest locale is what keeps a
   * language switch from reflowing the grid — see DataGrid's column types.
   * Omit for the one column that should absorb remaining space.
   */
  width?: string
}

export interface DataTableProps<T> {
  /**
   * Row height. `compact` is `py-2` (~36px at text-03) against
   * `comfortable`'s `py-3` (~44px) — an 18% reduction, which at 20 rows a
   * page is the difference between the table fitting one 1080p viewport and
   * not.
   *
   * It lived on DataGrid, so only the two pages on DataGrid could reach it
   * and exactly one used it; the other ten list pages call DataTable
   * directly. The default stays `comfortable`: the wider row is right where
   * each line is a decision, and wrong where the page is a scan-and-find.
   */
  density?: 'comfortable' | 'compact'
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

  /**
   * The rows on screen belong to the previous query while the next one loads.
   *
   * Pass `isPlaceholderData`. Several lists here set
   * `placeholderData: (previous) => previous` — the right call, and its comment
   * in `packages/core/src/hooks/useSouls.ts` gives the reason: a page turn
   * should not flash a skeleton over data about to be replaced by more of the
   * same. But it removed the only waiting signal the table had and put nothing
   * back. `isLoading` is false from then on, `TableSkeleton` never fires again,
   * and `isFetching` was consumed on exactly zero of these pages. So pressing
   * "next page" moved nothing at all until the new rows arrived, and the
   * operator's reading of that is "the button did not take".
   *
   * NOT `isFetching`: that is also true for a background refetch where the rows
   * on screen are the current ones and dimming them would be a lie.
   */
  isRefreshing?: boolean

  /**
   * Turns on row enter/change/exit motion, and carries the identity of the
   * question the table is asking — page, filters, sort, joined however the
   * caller likes.
   *
   * It is one prop and not two because the feature is unusable without the
   * key. A table that diffs its rows without knowing when the *query* changed
   * flags every row on the first load, on every page turn and on every filter
   * change — moments when nothing happened to the operator and everything
   * happened because of them. Leaving this undefined keeps the table exactly
   * as it was; there is no half-on state where rows animate but lie.
   *
   * See `src/hooks/useRowTransitions.ts` for what each of the three states
   * means and why the change highlight outlives the other two.
   */
  transitionKey?: string

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
  density = 'comfortable',
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
  transitionKey,
  isRefreshing,
  className,
}: DataTableProps<T>) {

  /* `transitionKey === undefined` hands the hook no data, so it computes
     nothing and returns empty sets — the opt-out is a real opt-out, not a
     flag checked at render time after the work is done. */
  const { entered, changed, leaving } = useRowTransitions(
    transitionKey === undefined ? undefined : data,
    keyExtractor,
    transitionKey ?? ''
  )

  const cellPadding = density === 'compact' ? 'px-4 py-2' : 'px-4 py-3'
  /**
   * The body rows come from `renderRow`, which every caller hand-writes — 40
   * `px-4 py-3` `<td>`s across app/. So a `density` prop alone would only have
   * moved the header, and the table would have looked broken at `compact`.
   *
   * A descendant selector on the table beats the single class on each `<td>`
   * without touching any of those call sites. It is scoped to `tbody` so the
   * header keeps `cellPadding` directly, and it only exists in the compact
   * branch — `comfortable` emits no override at all, so nothing changes for
   * the ten pages that do not opt in.
   */
  const bodyDensity = density === 'compact' ? '[&_tbody_td]:py-2' : ''
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
      {/* `` used to sit here. borderRadius.lg is 0 now, so it emitted
          nothing and only told the next reader this box had a corner radius. */}
      {/* `relative` 不是装饰,它决定绝对定位的后代被谁裁剪。
          没有它,这个滚动容器的 `position` 是 `static`,于是里面每一个
          `sr-only`(Tailwind 把它实现成 `position: absolute`)都以**初始包含块**
          为定位参照 —— 它逃出了 `overflow-x-auto` 的裁剪,按自己在滚动内容里的
          位置落到文档坐标上。

          实测:mobile-chrome(393px)的 `/permissions`,一个 `srOnlyHeader` 的
          `<span class="sr-only">` 落在 x=456,把 `documentElement.scrollWidth`
          撑到 **457**,而 `body.scrollWidth` 还是 393。

          这一处此前被记成「根因未知」,因为排查用的是「哪个元素看起来超出去了」——
          那个判据在这里给出**零个**答案:127 个超宽元素每一个都有 overflow-x
          祖先,而真正的元凶宽 **1px**、`clip: rect(0,0,0,0)`,肉眼和截图都看不见。
          正确的判据是 `documentElement.scrollWidth` vs `clientWidth`,以及
          「哪个元素隐藏后文档缩回去」。

          后果不止一条横向滚动条:所有 `fixed inset-0` 的遮罩与弹窗按 457 铺开、
          居中在 228,一半落在可视区外,里面的按钮「可见、可用、可滚动到」却点不动。 */}
      <div className="relative overflow-x-auto border border-[hsl(var(--color-hairline))]">
        {/* `text-03` (13px), not `text-sm` (14px). Every body cell that does not
            set its own size inherits from here, so this one class is the base
            size of thirteen pages' tables — and it was the single largest block
            of text still outside the eight-step scale. 13px is tighter than what
            it replaces: the scale buys hierarchy from the span between steps,
            not by growing rows, and the table is where density is defended. */}
        <table className={cn("w-full text-03", bodyDensity)} aria-busy={isLoading || undefined}>
          <caption className="sr-only">{caption}</caption>
          {columns.some((c) => c.width) && (
            <colgroup>
              {columns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
          )}
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
                      isSortable ? 'p-0' : cellPadding,
                      column.headerClassName
                    )}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className={cn(
                          'group flex w-full items-center gap-1.5 font-medium',
                          cellPadding,
                          'hover:text-[hsl(var(--color-ink))] transition-colors',
                          // Focus ring comes from the global :focus-visible rule
                          // in globals.css; a local one would double up on it.
                          sort?.key === column.key && 'text-[hsl(var(--color-accent-ink))]',
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
                      className="mt-3 text-[hsl(var(--color-accent-ink))] hover:underline"
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
                          className="mt-3 text-[hsl(var(--color-accent-ink))] hover:underline"
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
            <tbody
              aria-busy={isRefreshing || undefined}
              className={cn(
                'transition-opacity duration-settle',
                isRefreshing ? 'opacity-50 ease-exit' : 'opacity-100 ease-enter'
              )}
            >
              {data?.map((item, index) => {
                const rowKey = keyExtractor(item, index)
                return (
                  <tr
                    key={rowKey}
                    data-row-state={
                      entered.has(rowKey) ? 'entered' : changed.has(rowKey) ? 'changed' : undefined
                    }
                    className={cn(
                      'border-b border-[hsl(var(--color-hairline))] last:border-0 hover:bg-[hsl(var(--color-surface-2))] transition-colors',
                      entered.has(rowKey) && 'animate-row-enter',
                      changed.has(rowKey) && 'animate-row-changed'
                    )}
                  >
                    {renderRow(item, index)}
                  </tr>
                )
              })}
              {/* ROWS ON THEIR WAY OUT, and every one of them is inert.
                  They are drawn from the previous snapshot, so the record each
                  one describes is already gone: `aria-hidden` keeps them out
                  of the accessibility tree, and `pointer-events-none` keeps
                  the action buttons inside `renderRow` from being clicked
                  during the 240ms they remain visible. A departing row that
                  could still be acted on would be a worse defect than the
                  abrupt disappearance this replaces.

                  The index passed to `renderRow` is the position the row had,
                  which is the only honest answer — it no longer has one. */}
              {leaving.map(({ key, item }, index) => (
                <tr
                  key={`leaving-${key}`}
                  aria-hidden="true"
                  data-row-state="leaving"
                  className="border-b border-[hsl(var(--color-hairline))] last:border-0 pointer-events-none animate-row-exit"
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
