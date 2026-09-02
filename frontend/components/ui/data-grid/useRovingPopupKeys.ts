"use client"

import { useCallback, useEffect, useRef, useState } from 'react'

interface RovingPopupOptions {
  /** Which entries the keyboard may land on. `false` for disabled ones. */
  enabled: boolean[]
  /** Called when the popup should close. `restoreFocus` says whether the
   *  keyboard is mid-flight and needs putting back on the trigger. */
  onRequestClose: (restoreFocus: boolean) => void
  /** True while the popup is mounted. */
  open: boolean
}

/**
 * The keyboard half of a `role="menu"` / `role="listbox"` popup.
 *
 * Extracted because it was missing from BOTH grid popups in the same way, and
 * writing it twice is how it drifts back apart. `ActionsMenu` (row actions,
 * `role="menu"`) and `FilterBar`'s chips (`role="listbox"`) each declared the
 * role and implemented none of the navigation it promises: no focus on open,
 * no arrow keys, no focus restored on close. Declaring the role is a promise
 * to a screen-reader user that arrow keys work; both were making it and
 * neither was keeping it.
 *
 * What this owns: moving focus into the popup when it opens, ArrowUp/Down with
 * wrap, Home/End, skipping disabled entries, and Escape. What it deliberately
 * does NOT own: outside-click and reposition handling, which differ between
 * the two (one is portaled and closes on scroll, the other is not), and the
 * decision of what "close" means, which is the caller's.
 */
export function useRovingPopupKeys({ enabled, onRequestClose, open }: RovingPopupOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const enabledIndices = useCallback(
    () => enabled.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0),
    [enabled]
  )

  const focusItem = useCallback((index: number) => {
    itemRefs.current[index]?.focus()
  }, [])

  // Focus into the popup once it exists. Without this the popup opens behind
  // the keyboard: the role announces navigation and Tab walks straight past.
  useEffect(() => {
    if (!open) return
    const first = enabledIndices()[0]
    if (first !== undefined) focusItem(first)
  }, [open, enabledIndices, focusItem])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onRequestClose(true)
        return
      }
      if (e.key === 'Tab') {
        // Tab out, not through. Roving focus means the entries are not tab
        // stops, and for a portaled popup DOM order would send Tab somewhere
        // unrelated to the trigger anyway.
        onRequestClose(false)
        return
      }
      if (!containerRef.current?.contains(document.activeElement)) return

      const list = enabledIndices()
      if (list.length === 0) return
      const current = itemRefs.current.findIndex((el) => el === document.activeElement)
      const here = list.indexOf(current)

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          focusItem(list[here < 0 ? 0 : (here + 1) % list.length])
          break
        case 'ArrowUp':
          e.preventDefault()
          focusItem(list[here < 0 ? list.length - 1 : (here - 1 + list.length) % list.length])
          break
        case 'Home':
          e.preventDefault()
          focusItem(list[0])
          break
        case 'End':
          e.preventDefault()
          focusItem(list[list.length - 1])
          break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, enabledIndices, focusItem, onRequestClose])

  return { containerRef, itemRefs }
}

/**
 * The open/closed half, with the one rule that kept getting missed: closing
 * has to say where focus goes.
 */
export function usePopupOpenState(triggerRef: React.RefObject<HTMLButtonElement | null>) {
  const [open, setOpen] = useState(false)

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus()
    },
    [triggerRef]
  )

  return { open, setOpen, close }
}
