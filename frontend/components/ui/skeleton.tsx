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
        'animate-pulse rounded-md bg-[hsl(var(--color-surface-2))]',
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
    <div className="border rounded-lg p-4 space-y-3">
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
    <div className={cn('bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]', className)}>
      <Skeleton className="h-4 w-24 mb-4" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  )
}
