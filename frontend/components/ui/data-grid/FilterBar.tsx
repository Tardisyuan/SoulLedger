"use client"

import { useEffect, useRef } from 'react'

import { usePopupOpenState, useRovingPopupKeys } from './useRovingPopupKeys'
import { cn } from '@/lib/utils'

export interface FilterChipOption {
  value: string
  label: string
}

export interface FilterChipConfig {
  key: string
  /** Chip label, e.g. "资源" / "Resource". */
  label: string
  /** Current value; empty string means "not set". */
  value: string
  options: FilterChipOption[]
  onChange: (value: string) => void
}

export interface FilterBarProps {
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  chips?: FilterChipConfig[]
  isFiltered: boolean
  onClearAll: () => void
  clearAllLabel: string
  density?: { compact: boolean; onToggle: () => void; label: string }
  className?: string
}

/**
 * Filter bar per §7: no native `<select>` or `<input type="date">` — they
 * render browser chrome (mm/dd/yyyy, OS-styled listboxes) that can't be
 * localised or kept visually consistent across zh-Hans/en/egy. Every control
 * is 36px, matching compact row height.
 */
/**
 * A chip's dropdown declares `role="listbox"` with `role="option"` children.
 * That is a promise of arrow-key navigation, and it was not being kept: the
 * only key handled was Escape, which closed the popup and left focus on the
 * body. Unlike ActionsMenu this one is not portaled, so Tab did reach the
 * options — the reachability failure was narrower here, the broken promise
 * identical. Both now share `useRovingPopupKeys`.
 */
function FilterChip({ config }: { config: FilterChipConfig }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { open, setOpen, close } = usePopupOpenState(triggerRef)
  const { containerRef: listRef, itemRefs } = useRovingPopupKeys({
    open,
    // No option is ever disabled here; the array still has to be the right
    // length, because the hook indexes the refs by it.
    enabled: config.options.map(() => true),
    onRequestClose: close,
  })

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open, close])

  const active = config.value !== ''
  const activeOption = config.options.find((o) => o.value === config.value)

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          setOpen(true)
        }}
        className={cn(
          'flex items-center gap-2 h-9 px-3 border text-03 transition-colors',
          active
            ? 'bg-[hsl(var(--color-accent)/0.12)] border-[hsl(var(--color-accent)/0.4)] text-[hsl(var(--color-ink))]'
            : 'bg-[hsl(var(--color-surface-2))] border-[hsl(var(--color-hairline-strong))] text-[hsl(var(--color-ink))] hover:border-[hsl(var(--color-hairline-tertiary))]'
        )}
      >
        <span>{activeOption ? activeOption.label : config.label}</span>
        <span className={cn('font-mono text-02', active ? 'text-[hsl(var(--color-accent-ink))]' : 'text-[hsl(var(--color-ink-tertiary))]')}>▾</span>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={config.label}
          className="absolute left-0 top-full mt-1 z-30 min-w-[180px] max-h-64 overflow-y-auto border border-[hsl(var(--color-hairline-strong))] bg-[hsl(var(--color-surface-4))] shadow-[0_16px_40px_-10px_hsl(0_0%_0%/0.6)] py-1"
        >
          {config.options.map((option, index) => (
            <button
              key={option.value}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              type="button"
              role="option"
              // Roving focus: inside a listbox the arrows are the navigation
              // and Tab is the way out, so the options must not also be tab
              // stops.
              tabIndex={-1}
              aria-selected={option.value === config.value}
              onClick={() => {
                config.onChange(option.value)
                close(true)
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-03 transition-colors',
                option.value === config.value
                  ? 'text-[hsl(var(--color-accent-ink))] bg-[hsl(var(--color-accent)/0.1)]'
                  : 'text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] hover:text-[hsl(var(--color-ink))]'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  chips,
  isFiltered,
  onClearAll,
  clearAllLabel,
  density,
  className,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2.5 p-4 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline-strong))]',
        className
      )}
    >
      {onSearchChange && (
        <div className="flex items-center gap-2 h-9 px-3 border border-[hsl(var(--color-hairline-strong))] bg-[hsl(var(--color-surface-2))] min-w-[220px]">
          <span aria-hidden="true" className="font-mono text-03 text-[hsl(var(--color-ink-tertiary))]">
            ⌕
          </span>
          <input
            type="text"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-tertiary))] focus:outline-hidden"
          />
        </div>
      )}
      {chips?.map((chip) => (
        <FilterChip key={chip.key} config={chip} />
      ))}
      <div className="flex-1" />
      {isFiltered && (
        <button type="button" onClick={onClearAll} className="text-03 text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-ink))]">
          {clearAllLabel}
        </button>
      )}
      {density && (
        <button
          type="button"
          onClick={density.onToggle}
          aria-pressed={density.compact}
          className={cn(
            'h-9 px-3 border text-03 transition-colors',
            density.compact
              ? 'bg-[hsl(var(--color-accent)/0.12)] border-[hsl(var(--color-accent)/0.4)] text-[hsl(var(--color-ink))]'
              : 'bg-[hsl(var(--color-surface-2))] border-[hsl(var(--color-hairline-strong))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]'
          )}
        >
          {density.label}
        </button>
      )}
    </div>
  )
}
