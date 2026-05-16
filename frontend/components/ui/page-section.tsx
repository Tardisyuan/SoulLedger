import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

interface PageSectionProps {
  title?: string
  isLoading?: boolean
  error?: unknown
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}

export function PageSection({
  title,
  isLoading,
  error,
  children,
  className,
  actions,
}: PageSectionProps) {
  return (
    <div className={cn('bg-surface-1 border border-hairline rounded-lg p-4', className)}>
      {title && (
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-base font-semibold text-[hsl(var(--color-ink))]">{title}</h3>
          {actions}
        </div>
      )}
      {error ? (
        <div className="text-red-400 text-sm py-4 text-center">{String(error)}</div>
      ) : isLoading ? (
        <div className="space-y-2">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}

// Data row with loading skeleton
export function DataRow({
  label,
  value,
  isLoading,
  color,
}: {
  label: string
  value?: React.ReactNode
  isLoading?: boolean
  color?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink">{label}</span>
      {isLoading ? (
        <Skeleton className="h-4 w-12" />
      ) : (
        <span className={cn('text-sm font-mono text-ink-muted', color)}>{value}</span>
      )}
    </div>
  )
}

// List item with loading skeleton
export function ListItem({
  children,
  isLoading,
}: {
  children: React.ReactNode
  isLoading?: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-2">
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }
  return children
}

// Card grid item with loading skeleton
export function CardGridItem({
  children,
  isLoading,
}: {
  children: React.ReactNode
  isLoading?: boolean
}) {
  if (isLoading) {
    return (
      <div className="bg-surface-2 rounded-lg p-4 border border-hairline">
        <Skeleton className="h-4 w-1/3 mb-2" />
        <Skeleton className="h-8 w-1/2 mb-2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    )
  }
  return children
}

// Stat card with loading skeleton
export function StatCard({
  label,
  value,
  isLoading,
  valueColor = 'text-amber-400',
}: {
  label: string
  value?: number | string
  isLoading?: boolean
  valueColor?: string
}) {
  return (
    <div className="bg-surface-1 rounded-lg p-4 border border-hairline">
      <div className="text-xs text-ink-muted uppercase mb-1">{label}</div>
      {isLoading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className={cn('text-2xl font-bold', valueColor)}>{value ?? 0}</div>
      )}
    </div>
  )
}

// Chart placeholder with loading skeleton
export function ChartSection({
  title,
  isLoading,
  error,
  children,
  height = 240,
}: {
  title?: string
  isLoading?: boolean
  error?: unknown
  children: React.ReactNode
  height?: number
}) {
  return (
    <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
      {title && <h3 className="text-sm font-semibold text-ink-muted uppercase mb-4">{title}</h3>}
      {isLoading ? (
        <div className="flex items-center justify-center" style={{ height }}>
          <Skeleton className="h-full w-full" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center text-red-400" style={{ height }}>
          {String(error)}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
