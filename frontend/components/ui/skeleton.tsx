import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  /** Element to render. Default 'div'; use 'span' inside a <p> or other
   *  phrasing-content parent. */
  as?: 'div' | 'span' 
}

export function Skeleton({ className, as: Tag = 'div' }: SkeletonProps) {
  // `as` exists because a <div> is not legal everywhere a placeholder is
  // wanted. PageShell's subtitle slot renders a <p>, and putting the default
  // <div> in it made React report "In HTML, <div> cannot be a descendant of
  // <p>" followed by a hydration mismatch -- the subtree discarded and
  // re-rendered on every load of /souls/[id]. Callers in inline contexts pass
  // `as="span"` and add `inline-block` for the height to apply.
  return (
    <Tag
      className={cn(
        /* `--color-hairline`, NOT a surface token.
         *
         * A skeleton block is one of the ~29% of surface fills in this app that
         * ships with no border, so the fill is the ONLY thing separating it from
         * what it sits on — and the surface ramp cannot do that job. Measured
         * 2026-09-02: `--color-surface-2` against the canvas is 1.05:1, and
         * `animate-pulse` drops opacity to 0.5, so the trough is **1.02:1**. A
         * loading state that is, in the literal sense, invisible.
         *
         * The hairline is the token that already means "the quietest visible
         * boundary": 1.44:1 full and 1.15:1 at the pulse trough in dark mode —
         * about 14x the perceptual separation, and it touches none of the 128
         * pinned ink-on-surface combinations because the hairline family is in
         * neither ramp. */
        'animate-pulse bg-[hsl(var(--color-hairline))]',
        className
      )}
    />
  )
}

// 表格骨架屏 - 使用 tr/td 以便在 tbody 中使用
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {/* 表头 */}
      <tr className="border-b border-[hsl(var(--color-hairline))]">
        {Array.from({ length: cols }).map((_, i) => (
          <td key={i} className="px-4 py-3">
            <Skeleton className="h-4 w-full" />
          </td>
        ))}
      </tr>
      {/* 行 */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-[hsl(var(--color-hairline))]">
          {Array.from({ length: cols }).map((_, colIdx) => (
            <td key={colIdx} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// 卡片骨架屏
export function CardSkeleton() {
  return (
    <div className="border p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

// 列表骨架屏
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

// 面板骨架屏 - 比 CardSkeleton 更重的样式,用于详情页面板
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn('bg-[hsl(var(--color-surface-1))] p-5 border border-[hsl(var(--color-hairline))]', className)}>
      <Skeleton className="h-4 w-24 mb-4" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  )
}
