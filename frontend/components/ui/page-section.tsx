import { cn } from '@/lib/utils'

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
          <h3 className="text-06 text-[hsl(var(--color-ink))]">{title}</h3>
          {actions}
        </div>
      )}
      {error ? (
        <div className="text-red-400 text-04 py-4 text-center">{String(error)}</div>
      ) : isLoading ? (
        <div className="space-y-2">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}
