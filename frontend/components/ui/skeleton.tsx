'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** 规范 v1 §1.7:骨架屏不闪烁,400 ms 后才出现。快于这个的加载,用户什么都不该看见。 */
export const SKELETON_DELAY_MS = 400
/** 第五十八批 M6:骨架一旦出现,至少停 300 ms,免得闪一下就没了。TODO(batch59 token): motion.skeleton 生成变量后改读它。 */
export const SKELETON_MIN_SHOWN_MS = 300

/**
 * Whether to keep showing a skeleton (M6). True while `loading`; and if the skeleton became visible (400 ms in), true
 * until it has been visible for 300 ms, even if the data arrived sooner. A load done before 400 ms never shows one.
 */
export function useSkeletonHold(loading: boolean): boolean {
  const [held, setHeld] = useState(false)
  const [prev, setPrev] = useState(loading)
  if (loading !== prev) {
    setPrev(loading)
    if (loading) setHeld(false)
  }
  // The 300 ms runs from the moment the skeleton appeared, so it is started by that timer, not by a later effect —
  // and it is not cleared when the load ends (that is the point); only unmount clears it.
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!loading) return
    const id = setTimeout(() => {
      setHeld(true)
      clearTimeout(release.current)
      release.current = setTimeout(() => setHeld(false), SKELETON_MIN_SHOWN_MS)
    }, SKELETON_DELAY_MS)
    return () => clearTimeout(id)
  }, [loading])
  useEffect(() => () => clearTimeout(release.current), [])
  return loading || held
}

/** 第五十八批 M9:「加载更多」进行中,列表底部两行骨架(同样等 400 ms 才出现)。 */
export function LoadMoreSkeleton() {
  return (
    <div aria-hidden="true" data-load-more-skeleton="" className="grid gap-2 py-2">
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-2 border-b border-[oklch(var(--color-line))] pb-3">
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
      ))}
    </div>
  )
}

interface SkeletonProps {
  className?: string
  /** Element to render. Default 'div'; use 'span' inside a <p> or other
   *  phrasing-content parent. */
  as?: 'div' | 'span' 
}

export function Skeleton({ className, as: Tag = 'div' }: SkeletonProps) {
  // `invisible`, not "render nothing": the block holds its final-layout space
  // from the first frame, so neither the 400 ms reveal nor the load finishing
  // moves anything (spec: 加载完成不跳版). The element stays in the DOM
  // throughout, so e2e waits on `data-slot="skeleton"` still see it.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShown(true), SKELETON_DELAY_MS)
    return () => clearTimeout(id)
  }, [])
  // `as` exists because a <div> is not legal everywhere a placeholder is
  // wanted. PageShell's subtitle slot renders a <p>, and putting the default
  // <div> in it made React report "In HTML, <div> cannot be a descendant of
  // <p>" followed by a hydration mismatch -- the subtree discarded and
  // re-rendered on every load of /souls/[id]. Callers in inline contexts pass
  // `as="span"` and add `inline-block` for the height to apply.
  return (
    <Tag
      /* 加载态的稳定标记,给测试用。
       *
       * `e2e/error-states-differ-from-empty.spec.ts` 要等「这一屏已经是最终状态」
       * 才去读正文,而那八个页面的加载态一律是这个组件。按类名找不行:
       * `animate-pulse` 还长在别处(实测 /tenants 上有一个 `w-2 h-2 
    * animate-pulse` 的状态圆点常驻),而 `bg-[oklch(var(--color-line))]`
       * 是 Tailwind 的任意值,拿它当选择器等于把测试钉在一个可以随时改的样式上。 */
      data-slot="skeleton"
      className={cn(
        /* `--color-line`, NOT a surface token.
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
        // 静态(交互与动效第 2 轮「骨架屏:静态骨架，不做闪光;数据到了交叉淡化成内容」)。
        'bg-[oklch(var(--color-line))]',
        !shown && 'invisible',
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
      <tr className="border-b border-[oklch(var(--color-line))]">
        {Array.from({ length: cols }).map((_, i) => (
          <td key={i} className="px-4 py-3">
            <Skeleton className="h-4 w-full" />
          </td>
        ))}
      </tr>
      {/* 行 */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        // 与 DataTable 的正文行同高(`--table-row-h`),骨架换成内容时不跳行。
        <tr key={rowIdx} className="h-(--table-row-h) border-b border-[oklch(var(--color-line))]">
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

