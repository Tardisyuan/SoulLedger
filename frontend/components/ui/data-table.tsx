"use client"

import { Fragment } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableSkeleton } from './skeleton'
import { Pagination } from '@/src/components/ui/Pagination'
import { Button } from '@/src/components/ui/Button'
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

/** The one link in a `linkedRows` row: its `::after` covers the whole row. */
export const ROW_LINK = 'after:absolute after:inset-0'

/*
 * 行的悬停 / 选中(规范 v3 `.ds-tr.hover` / `.ds-tr.selected`,2026-10-01 起)。
 *
 * v2 两者都是 surface-2,悬停与选中同色,只差选中那道竖条。v3 把它们拆成两档:
 * 悬停 = ink 4% 混进 surface-1,选中 = ink 7% 混进 surface-1。
 * 选中行不再挂悬停类 —— 否则指针一经过,7% 的底会退成 4%,读起来像取消了选中。
 * 调用方写 `on ? ROW_SELECTED : ROW_HOVER`,不要两个都给。
 *
 * **选中行没有行首竖条**,这是 2026-10-01 用户拍板,偏离 v3(v3 的 `.ds-tr.selected`
 * 带一道 3px ink inset)。原因:行首 3px 竖条是「待我处理」(`RowMark`,补足 B12)的
 * 专用记号;选中也画一道时,浅色主题、中性文明皮下两条几乎同色(ink 对 civ-neutral
 * 1.19:1,ΔE00 4.71),审判队列里「我的」与「选中的」分不开。于是竖条整条让给
 * 「待我处理」,选中只靠底色 —— 与「3px 色标只表示待我处理」那条既有规矩一致。
 *
 * 4 / 7 两档、以及「选中不画竖条」由 `v3DataDisplayContract.test.tsx` 守着,
 * 行底上的文字对比度也在那里按两档主题算。
 */
export const ROW_HOVER =
  'hover:bg-[color-mix(in_oklab,oklch(var(--color-ink))_4%,oklch(var(--color-surface-1)))]'
export const ROW_SELECTED =
  'bg-[color-mix(in_oklab,oklch(var(--color-ink))_7%,oklch(var(--color-surface-1)))]'

/*
 * 批量条(规范 v3 `.ds-batch`,2026-10-01 起):反相 —— ink 实底、surface-1 字,条上的
 * 按钮用 `<Button variant="inverse">`(无框文字按钮,焦点环换成 surface-1,因为全局的
 * ink 环落在 ink 底上会消失)。v3 的 52px 最小高度**没有**采用:尺寸整体不动是拍板。
 * 边框保持原样 —— 它们是 `--color-block`,两档主题都等于 ink,与底同色,留着是为了
 * 不让条的高度变 2px。
 */
export const BATCH_BAR = 'bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))]'

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

/**
 * 规范 v1 §3.1「有接口」的批量选择:行首一列复选框。
 *
 * The checkbox sits in its own cell, lifted above a `linkedRows` row's
 * `::after` overlay (`relative z-[1]`) and wrapped in a `<label>` that fills
 * the cell — so a click anywhere in that cell toggles the box and never
 * follows the row link, and the box is an ordinary tab stop that Space toggles.
 * The caller owns the set; the table only draws it.
 */
export interface DataTableSelection<T> {
  selected: ReadonlySet<string>
  onToggle: (key: string, item: T, checked: boolean) => void
  /** The header box: true selects every row on screen, false clears them. */
  onToggleAll: (checked: boolean) => void
  /** Accessible name of one row's box, e.g. 「选择 沈青梧」. */
  rowLabel: (item: T) => string
  allLabel: string
}

export interface DataTableProps<T> {
  /**
   * Row height. `comfortable`(默认)是规范 v3 的 64px 最小行高(`--table-row-h`);
   * `compact` 不设最小高度,行高只由 `py-1` 与内容决定。2026-10-01 起全站按 v3 走,
   * 没有调用点传 `compact` —— 它留着是给「这一页确实要更密」的那一次决定。
   *
   * It lived on DataGrid, so only the two pages on DataGrid could reach it
   * and exactly one used it; the other ten list pages call DataTable
   * directly. The default stays `comfortable`: the wider row is right where
   * each line is a decision, and wrong where the page is a scan-and-find.
   */
  density?: 'comfortable' | 'compact'
  /**
   * 规范 v1 §3.2: the whole row opens the record, no「查看 →」column. The row
   * becomes the positioning box and `cursor-pointer`; the caller puts ONE
   * `<Link className={ROW_LINK}>` in the row (usually on the name) whose
   * `::after` stretches over the row. Still one tab stop and a real link, so
   * middle-click and screen readers keep working — an `onClick` on the `<tr>`
   * would give neither.
   */
  linkedRows?: boolean
  columns: DataTableColumn[]
  data?: T[]
  keyExtractor: (item: T, index: number) => string
  /** Returns the `<td>` cells for one row; the `<tr>` is supplied by the table. */
  renderRow: (item: T, index: number) => React.ReactNode
  /**
   * 分组头(第三类 A 组 `isHead`):return a node to draw a full-width head row
   * ABOVE this row, or null for none. Called per row with its index, so the
   * caller decides where a group starts (e.g. the audit trail's day change).
   * A `<th scope="colgroup">`, so the head is announced as a header.
   */
  groupHeader?: (item: T, index: number) => React.ReactNode | null
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

  /** Leading checkbox column; see `DataTableSelection`. Omitted: no column. */
  selection?: DataTableSelection<T>

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
  groupHeader,
  caption,
  isLoading,
  isError,
  onRetry,
  errorMessage,
  skeletonRows = 5,
  density = 'comfortable',
  linkedRows = false,
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
  selection,
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

  /* 行高按规范 v3(2026-10-01 拍板):正文行 `min-height: 64px`(`--table-row-h`,v3 `.queue-row`
     / `.ds-tr`),表头 44(`--control-h-sm`,v3 `.queue-head` / `.ds-th`)。`<tr>` 上的 `height`
     在表格布局里就是最小高度 —— 内容更高时行照样长高。`compact` 不加这一条:它是显式的
     「我要更密」,而且目前没有任何调用点传它。 */
  const rowHeight = density === 'compact' ? '' : 'h-(--table-row-h)'
  const cellPadding = density === 'compact' ? 'px-3 py-1' : 'px-3 py-2'
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
  const bodyDensity = density === 'compact' ? '[&_tbody_td]:py-1' : ''
  const { t } = useI18n()
  const colCount = columns.length + (selection ? 1 : 0)
  const keysOnScreen = selection ? (data ?? []).map((item, i) => keyExtractor(item, i)) : []
  const selectedOnScreen = keysOnScreen.filter((k) => selection?.selected.has(k)).length
  const allOnScreen = keysOnScreen.length > 0 && selectedOnScreen === keysOnScreen.length

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
      {/* 账页不装框:表格没有外框,表头下接区块边界线,行与行之间是行线(规范 v1 §2)。 */}
      <div className="relative overflow-x-auto">
        {/* `text-sm` (13px), not `text-sm` (14px). Every body cell that does not
            set its own size inherits from here, so this one class is the base
            size of thirteen pages' tables — and it was the single largest block
            of text still outside the eight-step scale. 13px is tighter than what
            it replaces: the scale buys hierarchy from the span between steps,
            not by growing rows, and the table is where density is defended. */}
        <table className={cn("w-full text-sm", bodyDensity)} aria-busy={isLoading || undefined}>
          <caption className="sr-only">{caption}</caption>
          {columns.some((c) => c.width) && (
            <colgroup>
              {selection && <col style={{ width: '44px' }} />}
              {columns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
          )}
          {/* 补足 C15 表格细节 / B9:表头 11 等宽 ink3,下沿 2px ink。 */}
          <thead className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
            <tr className="h-(--control-h-sm) border-b-2 border-[oklch(var(--color-ink))]">
              {selection && (
                <th scope="col" className="w-11 p-0">
                  <label className="flex h-full min-h-(--control-h-sm) items-center justify-center px-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allOnScreen}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedOnScreen > 0 && !allOnScreen
                      }}
                      disabled={keysOnScreen.length === 0}
                      onChange={(e) => selection.onToggleAll(e.target.checked)}
                      aria-label={selection.allLabel}
                      className="w-3.5 h-3.5 accent-[oklch(var(--color-accent))]"
                    />
                  </label>
                </th>
              )}
              {columns.map((column) => {
                const align = ALIGN_CLASS[column.align ?? 'left']
                const isSortable = Boolean(column.sortable && onSortChange)
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort(column)}
                    className={cn(
                      'font-normal',
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
                          'group flex min-h-(--control-h-sm) w-full items-center gap-1.5 font-normal',
                          cellPadding,
                          'hover:text-[oklch(var(--color-ink))] transition-colors',
                          // Focus ring comes from the global :focus-visible rule
                          // in globals.css; a local one would double up on it.
                          sort?.key === column.key && 'text-[oklch(var(--color-accent-ink))]',
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
              <TableSkeleton rows={skeletonRows} cols={colCount} />
            </tbody>
          )}

          {isError && (
            <tbody>
              <tr>
                <td colSpan={colCount} className="px-3 py-8">
                  {/* 补足 C15「出错」:冷玫红「✕ 原因」13 / 600 + 次按钮「重试」,在内容区里,不换整页。 */}
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm font-semibold text-[oklch(var(--color-danger))]">
                      <span aria-hidden="true">✕ </span>
                      {errorMessage ?? t('common.error')}
                    </p>
                    {onRetry && (
                      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                        {t('common.retry')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          )}

          {isEmpty && (
            <tbody>
              <tr>
                <td colSpan={colCount} className="px-3 py-8">
                  {/* 补足 C15「空」:居左,一句话 15 / 600,给一条出路。 */}
                  <p className="text-md font-semibold text-[oklch(var(--color-ink))]">
                    {isFiltered
                      ? (filteredEmptyMessage ?? t('table.no_results'))
                      : (emptyMessage ?? t('table.empty'))}
                  </p>
                  {isFiltered
                    ? onClearFilters && (
                        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onClearFilters}>
                          {t('filter.clear_all')}
                        </Button>
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
                const head = groupHeader?.(item, index)
                return (
                  <Fragment key={rowKey}>
                  {head != null && (
                    <tr data-group-head="" className="border-b border-[oklch(var(--color-block))]">
                      <th
                        scope="colgroup"
                        colSpan={colCount}
                        className="px-4 pt-4 pb-1 text-left font-mono text-2xs font-normal text-[oklch(var(--color-ink-subtle))]"
                      >
                        {/* Sticky: at 393 px wide tables scroll sideways, and a
                            head that scrolls away with the first column is a
                            day nobody can see. */}
                        <span className="sticky left-4">{head}</span>
                      </th>
                    </tr>
                  )}
                  <tr
                    data-row-state={
                      entered.has(rowKey) ? 'entered' : changed.has(rowKey) ? 'changed' : undefined
                    }
                    className={cn(
                      'border-b border-[oklch(var(--color-rule))] transition-colors',
                      rowHeight,
                      linkedRows && 'relative cursor-pointer',
                      selection?.selected.has(rowKey) ? ROW_SELECTED : ROW_HOVER,
                      entered.has(rowKey) && 'animate-row-enter',
                      changed.has(rowKey) && 'animate-row-changed'
                    )}
                  >
                    {selection && (
                      <td className="w-11 p-0 align-middle">
                        <label className="relative z-[1] flex min-h-(--control-h-sm) items-center justify-center px-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selection.selected.has(rowKey)}
                            onChange={(e) => selection.onToggle(rowKey, item, e.target.checked)}
                            aria-label={selection.rowLabel(item)}
                            className="w-3.5 h-3.5 accent-[oklch(var(--color-accent))]"
                          />
                        </label>
                      </td>
                    )}
                    {renderRow(item, index)}
                  </tr>
                  </Fragment>
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
                  className={cn('border-b border-[oklch(var(--color-rule))] pointer-events-none animate-row-exit', rowHeight)}
                >
                  {selection && <td className="w-11" />}
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
