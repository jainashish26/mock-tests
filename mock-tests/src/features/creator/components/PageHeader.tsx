import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: React.ReactNode
  /** Renders a back arrow; pair it with `backLabel` for screen readers. */
  backHref?: string
  backLabel?: string
  actions?: React.ReactNode
  /** Slot under the title, e.g. status pills or a result count. */
  meta?: React.ReactNode
  className?: string
}

/**
 * Heading block for the creator screens.
 *
 * Mobile-first: title and description stack full width with the actions below
 * them (full-size tap targets), then from `sm` up the actions move to the right
 * of the title on one row.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel = 'Back',
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {backHref ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Link href={backHref}>
                <ArrowLeft size={16} />
                {backLabel}
              </Link>
            </Button>
          ) : null}
          <h1 className="text-xl font-extrabold tracking-tight text-foreground break-words sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>

      {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
    </header>
  )
}
