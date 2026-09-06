import { cn } from '@/lib/utils'

/**
 * THE `isLoading` PROP IS GONE, and it was removed rather than implemented.
 *
 * It took a boolean and, when true, rendered `<div className="space-y-2">
 * {children}</div>` instead of `children`. The two branches differed by one
 * class, and that class is a no-op here: `space-y-*` sets margin on all but the
 * first child, and the children of that div are always a single element (each
 * caller passes one ternary). So the prop did nothing at all, under a name that
 * promises a loading state.
 *
 * IMPLEMENTING IT WOULD HAVE BEEN WORSE. All four callers that passed it —
 * `death-sync:79`, `dispatch:101`, `dispatch:124`, `actors:190` — already write
 * their own loading branch inside `children`, and those are shaped to their own
 * content: `actors` draws a nine-card grid with an icon block and three text
 * lines per card. A skeleton rendered *here* would replace all four of those
 * with one generic shape, which is the opposite of what a skeleton is for.
 *
 * `isRefreshing` below is the prop this section actually lacked, and it is not
 * the same question: it is about content that is stale rather than absent.
 */
interface PageSectionProps {
  title?: string
  /**
   * The content belongs to the previous query while the next one loads. Pass
   * `isPlaceholderData`.
   *
   * Both lists on `app/dispatch` set `placeholderData: (previous) => previous`,
   * which keeps the rows on screen and — as a side effect nobody replaced —
   * pins `isLoading` to false for the rest of the session. So a page turn or a
   * filter change moved nothing on screen at all until the new rows landed.
   */
  isRefreshing?: boolean
  error?: unknown
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}

export function PageSection({
  title,
  isRefreshing,
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
      ) : (
        <div
          aria-busy={isRefreshing || undefined}
          className={cn(
            'transition-opacity duration-settle',
            isRefreshing ? 'opacity-50 ease-exit' : 'opacity-100 ease-enter'
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
