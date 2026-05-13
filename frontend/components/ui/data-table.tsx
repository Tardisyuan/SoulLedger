"use client"

import { TableSkeleton } from './skeleton'

interface DataTableProps<T> {
  data?: T[]
  isLoading?: boolean
  isError?: boolean
  skeletonRows?: number
  skeletonCols?: number
  renderRow: (item: T, index: number) => React.ReactNode
  columns: string[]
  keyExtractor: (item: T) => string
  emptyMessage?: string
}

export function DataTable<T>({
  data,
  isLoading,
  isError,
  skeletonRows = 5,
  skeletonCols = 4,
  renderRow,
  columns,
  keyExtractor,
  emptyMessage = '暂无数据',
}: DataTableProps<T>) {
  if (isLoading) {
    return <TableSkeleton rows={skeletonRows} cols={skeletonCols} />
  }

  if (isError) {
    return <div className="text-red-500 py-8 text-center">加载失败</div>
  }

  if (!data?.length) {
    return <div className="text-muted-foreground py-8 text-center">{emptyMessage}</div>
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b">
          {columns.map((col) => (
            <th key={col} className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item, index) => (
          <tr key={keyExtractor(item)} className="border-b">
            {renderRow(item, index)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
