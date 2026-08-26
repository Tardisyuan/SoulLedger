"use client"

import { useEffect, useRef, useState } from 'react'
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
function FilterChip({ config }: { config: FilterChipConfig }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const active = config.value !== ''
  const activeOption = config.options.find((o) => o.value === config.value)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-9 px-3 rounded border text-03 transition-colors',
          active
            ? 'bg-[hsl(var(--color-accent)/0.12)] border-[hsl(var(--color-accent)/0.4)] text-[hsl(var(--color-ink))]'
            : 'bg-[hsl(var(--color-surface-2))] border-[hsl(var(--color-hairline-strong))] text-[hsl(var(--color-ink))] hover:border-[hsl(var(--color-hairline-tertiary))]'
        )}
      >
        <span>{activeOption ? activeOption.label : config.label}</span>
        <span className={cn('font-mono text-[11px]', active ? 'text-[hsl(var(--color-accent-ink))]' : 'text-[hsl(var(--color-ink-tertiary))]')}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={config.label}
          className="absolute left-0 top-full mt-1 z-30 min-w-[180px] max-h-64 overflow-y-auto rounded-md border border-[hsl(var(--color-hairline-strong))] bg-[hsl(var(--color-surface-4))] shadow-[0_16px_40px_-10px_hsl(0_0%_0%/0.6)] py-1"
        >
          {config.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === config.value}
              onClick={() => {
                config.onChange(option.value)
                setOpen(false)
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[13px] transition-colors',
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
        'flex flex-wrap items-center gap-2.5 p-4 rounded-lg bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline-strong))]',
        className
      )}
    >
      {onSearchChange && (
        <div className="flex items-center gap-2 h-9 px-3 rounded border border-[hsl(var(--color-hairline-strong))] bg-[hsl(var(--color-surface-2))] min-w-[220px]">
          <span aria-hidden="true" className="font-mono text-[13px] text-[hsl(var(--color-ink-tertiary))]">
            ⌕
          </span>
          <input
            type="text"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-tertiary))] focus:outline-none"
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
            'h-9 px-3 rounded border text-03 transition-colors',
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
