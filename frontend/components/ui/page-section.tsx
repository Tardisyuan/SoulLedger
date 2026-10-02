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
    // 规范 v3 面板(与 `app/dashboard` 的面板同一写法):1 px 结构线 + surface-1 底 + 16 内距;
    // 标题是面板标题(`text-lg`,界面字体,DESIGN.md「面板标题」)。v1 的 11 px 等宽栏目标签
    // 与压在标题下的区块线撤掉 —— 那是 v1「卡片 = 区块」的画法,v3 的面板靠底色与外框分层。
    <section className={cn('flex min-w-0 flex-col gap-3 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4', className)}>
      {title && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg text-[oklch(var(--color-ink))]">{title}</h2>
          {actions}
        </div>
      )}
      {error ? (
        // `--color-status-error`, not `text-red-400`. The raw class is one
        // fixed colour, so it rendered ~3:1 on light surfaces — under AA, on
        // the only text that says something went wrong. `role="alert"` because
        // a failure appearing in place of content is not something the reader
        // was looking for.
        <div role="alert" className="text-[oklch(var(--color-danger))] text-sm py-4">
          <span aria-hidden="true">! </span>
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
    </section>
  )
}
