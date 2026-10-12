"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { readFilters, writeFilters } from '@/src/lib/rememberedFilters'
import { cn } from '@/lib/utils'
import { usePopupOpenState, useRovingPopupKeys } from './useRovingPopupKeys'

/**
 * 列菜单(Design 第二十八批 W1):筛选条右端「列 · 6/9」,勾选要显示的列。
 *
 * 一个列表一份偏好,记在本浏览器(`rememberedFilters` 的同一套存取:坏了或被挡就当没有)。
 * 钉住的列(编号列、名称列)不能隐藏。宽度低于 `md`(DataTable 换成横滚 / 卡片排法的那条线)
 * 不出现,**也不生效**:窄屏上没有菜单可以把隐藏的列找回来,所以偏好在那里被忽略,不是被删除。
 * 导出不看这份偏好 —— 它只决定这张表画哪些列,不进任何请求。
 */
export interface ColumnMenuColumn {
  key: string
  header: string
  /** 不能隐藏。 */
  pinned?: boolean
}

const WIDE_QUERY = '(min-width: 768px)'

function useIsWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(WIDE_QUERY)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    // 没有 matchMedia(jsdom)按宽屏算,与 GlobalNav 的同一个退路。
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true),
    () => true
  )
}

export interface ColumnVisibility {
  /** 当前不画的列(窄屏恒为空)。 */
  hidden: ReadonlySet<string>
  isVisible: (key: string) => boolean
  toggle: (key: string) => void
  reset: () => void
  shown: number
  total: number
  wide: boolean
}

/** `storageKey`:一个列表一份,如 `soulledger.souls.columns`。存的是被隐藏的列键;列清单里没有的键原样保留(死亡日期列时有时无)。 */
export function useColumnVisibility(
  storageKey: string,
  columns: readonly { key: string; pinned?: boolean }[]
): ColumnVisibility {
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const raw = readFilters(storageKey, ['hidden'] as const).hidden
    setSaved(new Set(raw ? raw.split(',') : []))
  }, [storageKey])
  const wide = useIsWide()

  const pinned = useMemo(() => new Set(columns.filter((c) => c.pinned).map((c) => c.key)), [columns])
  const hidden = useMemo(() => {
    const keys = new Set(columns.map((c) => c.key))
    return wide ? new Set([...saved].filter((k) => keys.has(k) && !pinned.has(k))) : new Set<string>()
  }, [saved, columns, pinned, wide])

  const commit = useCallback(
    (next: Set<string>) => {
      setSaved(next)
      writeFilters(storageKey, { hidden: [...next].join(',') })
    },
    [storageKey]
  )
  const toggle = useCallback(
    (key: string) => {
      if (pinned.has(key)) return
      const next = new Set(saved)
      if (!next.delete(key)) next.add(key)
      commit(next)
    },
    [saved, pinned, commit]
  )
  const reset = useCallback(() => commit(new Set()), [commit])

  return {
    hidden,
    isVisible: (key) => !hidden.has(key),
    toggle,
    reset,
    shown: columns.length - hidden.size,
    total: columns.length,
    wide,
  }
}

export interface ColumnMenuProps {
  columns: ColumnMenuColumn[]
  visibility: ColumnVisibility
  /** `t("list.columns.button", { shown, total })` */
  buttonLabel: string
  /** `t("list.columns.pinned")` */
  pinnedLabel: string
  /** `t("list.columns.reset")` */
  resetLabel: string
  className?: string
}

export function ColumnMenu({ columns, visibility, buttonLabel, pinnedLabel, resetLabel, className }: ColumnMenuProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { open, setOpen, close } = usePopupOpenState(triggerRef)
  const { containerRef: menuRef, itemRefs } = useRovingPopupKeys({
    open,
    // 钉住的列键盘不落脚(disabled);「恢复默认」在没有隐藏列时也不可选。
    enabled: [...columns.map((c) => !c.pinned), visibility.hidden.size > 0],
    onRequestClose: close,
  })

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close(false)
    }
    function onReposition() {
      close(!!menuRef.current?.contains(document.activeElement))
    }
    document.addEventListener('mousedown', onDocPointerDown)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, close, menuRef])

  if (!visibility.wide) return null

  function openAt() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  return (
    <div className={cn('shrink-0', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(true) : openAt())}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          openAt()
        }}
        className="flex items-center gap-2 h-(--control-h-sm) px-3 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))] text-sm text-[oklch(var(--color-ink))] whitespace-nowrap transition-colors hover:border-[oklch(var(--color-hairline-tertiary))]"
      >
        <span>{buttonLabel}</span>
        <span aria-hidden="true" className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))]">▾</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={buttonLabel}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-sidebar min-w-[220px] border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] py-1"
          >
            {columns.map((column, index) => {
              const checked = column.pinned || visibility.isVisible(column.key)
              return (
                <button
                  key={column.key}
                  ref={(el) => {
                    itemRefs.current[index] = el
                  }}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  tabIndex={-1}
                  disabled={column.pinned}
                  onClick={() => visibility.toggle(column.key)}
                  className="flex min-h-(--control-h-sm) w-full items-center gap-2 text-left px-3 text-sm text-[oklch(var(--color-ink-muted))] transition-colors hover:bg-[oklch(var(--color-surface-3))] hover:text-[oklch(var(--color-ink))] disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <span aria-hidden="true" className="w-3 font-mono text-xs text-[oklch(var(--color-accent-ink))]">
                    {checked ? '✓' : ''}
                  </span>
                  <span>{column.header}</span>
                  {column.pinned && (
                    <span className="ml-auto pl-4 text-xs text-[oklch(var(--color-ink-subtle))]">{pinnedLabel}</span>
                  )}
                </button>
              )
            })}
            <div aria-hidden="true" className="my-1 h-px bg-[oklch(var(--color-hairline-strong))]" />
            <button
              ref={(el) => {
                itemRefs.current[columns.length] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={visibility.hidden.size === 0}
              onClick={() => {
                close(true)
                visibility.reset()
              }}
              className="flex min-h-(--control-h-sm) w-full items-center text-left px-3 text-sm text-[oklch(var(--color-ink-muted))] transition-colors hover:bg-[oklch(var(--color-surface-3))] hover:text-[oklch(var(--color-ink))] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resetLabel}
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
