"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"

interface PaginationProps {
  page: number
  pageSize: number
  count: number
  onChange: (page: number) => void
  disabled?: boolean
  className?: string
  /** Noun used in the range summary, e.g. "tests" or "questions". */
  itemLabel?: string
}

/**
 * Prev/next pagination with a plain-language range summary.
 *
 * Page numbers are deliberately omitted on small screens: a range summary plus
 * two large tap targets is easier to hit on a phone than a row of numbered
 * buttons, and the creator lists are usually short enough to scroll.
 */
export function Pagination({
  page,
  pageSize,
  count,
  onChange,
  disabled = false,
  className,
  itemLabel = "items",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(count, page * pageSize)

  if (count === 0) return null

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row",
        className
      )}
    >
      <p className="text-xs text-muted-foreground sm:text-sm" aria-live="polite">
        Showing <span className="font-semibold text-foreground">{from}</span>–
        <span className="font-semibold text-foreground">{to}</span> of{" "}
        <span className="font-semibold text-foreground">{count}</span> {itemLabel}
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 gap-1 px-3"
          disabled={disabled || page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label={`Previous page of ${itemLabel}`}
        >
          <ChevronLeft size={16} />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        <span className="min-w-20 text-center text-xs font-semibold text-foreground tabular-nums sm:text-sm">
          Page {page} / {totalPages}
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 gap-1 px-3"
          disabled={disabled || page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label={`Next page of ${itemLabel}`}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={16} />
        </Button>
      </div>
    </nav>
  )
}
