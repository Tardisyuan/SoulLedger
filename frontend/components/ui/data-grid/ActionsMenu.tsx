"use client"

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface OverflowMenuItem {
  key: string
  label: React.ReactNode
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

export interface ActionsMenuProps {
  /** One verb inline before the trigger — the design doc's resolution to the "two links run together" hazard. */
  primary?: { label: React.ReactNode; onSelect: () => void; disabled?: boolean }
  items: OverflowMenuItem[]
  /** Accessible name for the "⋯" trigger. */
  menuLabel: string
}

/**
 * The overflow menu spec ratified for the actions column (design doc open
 * item #3): one primary verb inline, everything else — including every
 * destructive action — behind a constant-width "⋯" trigger. Rendered via a
 * portal because the grid's horizontal scroll container clips `overflow-y`
 * too (setting `overflow-x` computes the other axis to `auto`), which would
 * otherwise cut the menu off for any row near the table's edge.
 */
export function ActionsMenu({ primary, items, menuLabel }: ActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onReposition() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open])

  function toggle() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen((o) => !o)
  }

  if (!primary && items.length === 0) return null

  return (
    <div className="inline-flex items-center gap-1 justify-end">
      {primary && (
        <button
          type="button"
          onClick={primary.onSelect}
          disabled={primary.disabled}
          className="px-2.5 py-1 rounded text-03 text-[hsl(var(--color-ink-muted))] border border-[hsl(var(--color-hairline-strong))] hover:text-[hsl(var(--color-ink))] hover:border-[hsl(var(--color-hairline-tertiary))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {primary.label}
        </button>
      )}
      {items.length > 0 && (
        <>
          {primary && <span aria-hidden="true" className="w-px h-4 bg-[hsl(var(--color-hairline-strong))]" />}
          <button
            ref={triggerRef}
            type="button"
            aria-label={menuLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
            className="px-2 py-1 rounded font-mono text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-3))] transition-colors"
          >
            ⋯
          </button>
          {open &&
            pos &&
            createPortal(
              <div
                ref={menuRef}
                role="menu"
                aria-label={menuLabel}
                style={{ position: 'fixed', top: pos.top, right: pos.right }}
                className="z-50 min-w-[168px] rounded-md border border-[hsl(var(--color-hairline-strong))] bg-[hsl(var(--color-surface-4))] shadow-[0_16px_40px_-10px_hsl(0_0%_0%/0.6)] py-1"
              >
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false)
                      item.onSelect()
                    }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-03 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                      item.tone === 'danger'
                        ? 'text-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.1)]'
                        : 'text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] hover:text-[hsl(var(--color-ink))]'
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>,
              document.body
            )}
        </>
      )}
    </div>
  )
}
