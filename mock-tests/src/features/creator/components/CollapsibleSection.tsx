'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

interface SectionProps {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
  /** Optional right-hand slot in the header, e.g. a count badge. */
  aside?: React.ReactNode
}

/**
 * Collapsible card used to group the creator editors' fields.
 *
 * A phone cannot show forty inputs at once, so secondary groups start collapsed.
 * The toggle is a full-width button (an easy target) with `aria-expanded`, so the
 * open state is announced rather than conveyed by the chevron alone.
 */
export function Section({ title, description, defaultOpen = true, children, aside }: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">{title}</span>
          {description ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {aside}
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>
      {open ? <div className="flex flex-col gap-4 border-t border-border p-4">{children}</div> : null}
    </section>
  )
}
