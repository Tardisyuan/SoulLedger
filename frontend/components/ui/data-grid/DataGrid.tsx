"use client"

import { useMemo, useRef, useEffect } from 'react'
import { DataTable, type SortState } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'
import { renderGridCell, toDataTableColumn, columnAlign, type DataGridColumn } from './columns'

export type { SortState } from '@/components/ui/data-table'
export { parseOrdering } from '@/components/ui/data-table'

/**
 * Selection — a capability Mode B tables opt into (§6). Off by default;
 * souls/judgments/dispatch never pass this prop. Permissions, menus, users
 * and the recycle bin are the intended callers.
 */
export interface DataGridSelection<T> {
  selectedIds: Set<string>
  getId: (row: T) => string
  onToggleRow: (id: string) => void
  onToggleAllVisible: (ids: string[]) => void
  onClear: () => void
  /** Rendered in the bulk bar between the count and the clear action. */
  bulkActions?: React.ReactNode
  /** Total count across every page/filter, for "select all N" beyond this page. */
  totalMatchingCount?: number
  onSelectAllMatching?: () => void
  getRowAriaLabel?: (row: T) => string
  labels: {
    selectedCount: (n: number) => string
    clearSelection: string
    selectAllLabel: string
    selectAllMatching?: (n: number) => string
  }
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[]
  data?: T[]
  keyExtractor: (item: T, index: number) => string
  caption: string

  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  errorMessage?: string
  skeletonRows?: number

  sort?: SortState | null
  onSortChange?: (next: SortState | null) => void

  isFiltered?: boolean
  emptyMessage?: string
  emptyAction?: React.ReactNode
  filteredEmptyMessage?: string
  onClearFilters?: () => void

  page?: number
  totalPages?: number
  totalCount?: number
  onPageChange?: (page: number) => void

  selection?: DataGridSelection<T>
  /** Comfortable (44px rows, decisions) or compact (36px rows, scan-and-find) — §4. */
  density?: 'comfortable' | 'compact'
  className?: string
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="accent-[hsl(var(--color-accent))] w-3.5 h-3.5 cursor-pointer"
    />
  )
}

/**
 * The one shared grid every migrated screen renders through. Column faces,
 * empty states, loading/error and pagination are DataTable's job (already
 * built and tested); DataGrid adds the typed column taxonomy (§1) on top and
 * the opt-in selection capability (§6).
 */
export function DataGrid<T>({
  columns,
  data,
  keyExtractor,
  caption,
  isLoading,
  isError,
  onRetry,
  errorMessage,
  skeletonRows,
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
  selection,
  density = 'comfortable',
  className,
}: DataGridProps<T>) {
  const cellPadding = density === 'compact' ? 'px-4 py-2' : 'px-4 py-3'

  const visibleIds = useMemo(
    () => (selection ? (data ?? []).map((row, i) => selection.getId(row) ?? keyExtractor(row, i)) : []),
    [selection, data, keyExtractor]
  )

  const tableColumns = useMemo(() => {
    const base = columns.map(toDataTableColumn)
    if (!selection) return base
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.selectedIds.has(id))
    const someSelected = visibleIds.some((id) => selection.selectedIds.has(id))
    return [
      {
        key: '__select__',
        header: (
          <SelectAllCheckbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            onChange={() => selection.onToggleAllVisible(visibleIds)}
            label={selection.labels.selectAllLabel}
          />
        ),
        width: '40px',
      },
      ...base,
    ]
  }, [columns, selection, visibleIds])

  function renderRow(row: T, index: number) {
    const cells = columns.map((column) => (
      <td
        key={column.key}
        className={cn(cellPadding, 'align-top', columnAlign(column.type) === 'right' && 'text-right', column.className)}
      >
        {renderGridCell(column, row)}
      </td>
    ))
    if (!selection) return <>{cells}</>
    const id = selection.getId(row) ?? keyExtractor(row, index)
    const checked = selection.selectedIds.has(id)
    return (
      <>
        <td className={cellPadding}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => selection.onToggleRow(id)}
            aria-label={selection.getRowAriaLabel?.(row) ?? selection.labels.selectAllLabel}
            className="accent-[hsl(var(--color-accent))] w-3.5 h-3.5 cursor-pointer"
          />
        </td>
        {cells}
      </>
    )
  }

  const selectedCount = selection?.selectedIds.size ?? 0

  return (
    <div className={className}>
      {/* Select-all means the page, not the query (§6) — onSelectAllMatching is
          an explicit second step, never implied by the header checkbox. */}
      {selection && selectedCount > 0 && (
        <div className="flex items-center gap-4 px-4 h-12 mb-2 bg-[hsl(var(--color-accent)/0.1)] border border-[hsl(var(--color-accent)/0.3)]">
          <span className="text-03 font-medium text-[hsl(var(--color-ink))]">{selection.labels.selectedCount(selectedCount)}</span>
          {selection.bulkActions && (
            <>
              <span aria-hidden="true" className="w-px h-[18px] bg-[hsl(var(--color-hairline-strong))]" />
              {selection.bulkActions}
            </>
          )}
          {selection.totalMatchingCount !== undefined &&
            selection.totalMatchingCount > selectedCount &&
            selection.onSelectAllMatching &&
            selection.labels.selectAllMatching && (
              <button
                type="button"
                onClick={selection.onSelectAllMatching}
                className="text-03 font-medium text-[hsl(var(--color-accent-ink))] hover:underline"
              >
                {selection.labels.selectAllMatching(selection.totalMatchingCount)}
              </button>
            )}
          <div className="flex-1" />
          <button type="button" onClick={selection.onClear} className="text-03 text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-ink))]">
            {selection.labels.clearSelection}
          </button>
        </div>
      )}
      <DataTable<T>
        columns={tableColumns}
        data={data}
        keyExtractor={keyExtractor}
        renderRow={renderRow}
        caption={caption}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        errorMessage={errorMessage}
        skeletonRows={skeletonRows}
        sort={sort}
        onSortChange={onSortChange}
        isFiltered={isFiltered}
        emptyMessage={emptyMessage}
        emptyAction={emptyAction}
        filteredEmptyMessage={filteredEmptyMessage}
        onClearFilters={onClearFilters}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        onPageChange={onPageChange}
      />
    </div>
  )
}
