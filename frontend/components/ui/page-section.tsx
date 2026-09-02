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
    <div className={cn('bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4', className)}>
      {title && (
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-06 text-[hsl(var(--color-ink))]">{title}</h3>
          {actions}
        </div>
      )}
      {error ? (
        // `--color-status-error`, not `text-red-400`. The raw class is one
        // fixed colour, so it rendered ~3:1 on light surfaces — under AA, on
        // the only text that says something went wrong. `role="alert"` because
        // a failure appearing in place of content is not something the reader
        // was looking for.
        <div role="alert" className="text-[hsl(var(--color-status-error))] text-04 py-4 text-center">
          {String(error)}
        </div>
      ) : isLoading ? (
        <div className="space-y-2">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}
