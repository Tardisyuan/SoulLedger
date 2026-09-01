"use client"

import { useEffect, useRef, useState } from 'react'

import { usePopupOpenState, useRovingPopupKeys } from './useRovingPopupKeys'
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
 *
 * THE PORTAL IS ALSO WHY THE KEYBOARD CONTRACT HAD TO BE WRITTEN BY HAND.
 * This declared `role="menu"` and `role="menuitem"` and implemented neither.
 * A screen reader is told by those roles that arrow keys move between items;
 * there were no arrow keys. Focus never entered the panel on open, and because
 * the panel is portaled to `document.body`, Tab from the trigger went to
 * whatever followed the trigger in the DOM — the next row's actions — rather
 * than into the menu it had just opened. Escape closed the panel and dropped
 * focus on the body. Every destructive action in the grid lives behind this
 * trigger, on every row of every table, so "reachable only by mouse" was the
 * practical state of delete/restore across the app (WCAG 2.1.1, 4.1.2).
 *
 * The contract now implemented, and why each piece:
 *   - opening moves focus to the first enabled item, so the menu is where the
 *     keyboard already is;
 *   - ArrowUp/ArrowDown wrap, Home/End jump — what `role="menu"` promises;
 *   - disabled items are skipped rather than focused-and-inert;
 *   - Escape and selection both restore focus to the trigger. Selection
 *     restores it BEFORE running the action: several of these open a modal,
 *     and @headlessui returns focus on close to whatever held it on open, so
 *     the trigger has to be that element or the return lands on the body;
 *   - Tab closes and lets the browser move on, rather than tabbing through a
 *     portal that sits nowhere near the trigger in DOM order.
 */
export function ActionsMenu({ primary, items, menuLabel }: ActionsMenuProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { open, setOpen, close } = usePopupOpenState(triggerRef)
  const { containerRef: menuRef, itemRefs } = useRovingPopupKeys({
    open,
    enabled: items.map((item) => !item.disabled),
    onRequestClose: close,
  })

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      // A click elsewhere is already choosing where focus goes.
      close(false)
    }
    function onReposition() {
      // The panel is about to be wrong about where it is. Take focus with it
      // if the keyboard is inside, or it lands on <body>.
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

  function openAt() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  function toggle() {
    if (open) close(true)
    else openAt()
  }

  /** ArrowDown/Up on the trigger opens the menu, as a menu button should. */
  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    e.preventDefault()
    openAt()
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
            onKeyDown={onTriggerKeyDown}
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
                {items.map((item, index) => (
                  <button
                    key={item.key}
                    ref={(el) => {
                      itemRefs.current[index] = el
                    }}
                    type="button"
                    role="menuitem"
                    // `-1`, not the default `0`: inside a `role="menu"` the
                    // arrow keys are the navigation and Tab is the way out, so
                    // the items must not also be tab stops.
                    tabIndex={-1}
                    disabled={item.disabled}
                    onClick={() => {
                      // Restore BEFORE the action runs — see the header note
                      // about @headlessui returning focus to whatever held it.
                      close(true)
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
