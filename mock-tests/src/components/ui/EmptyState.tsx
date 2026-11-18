import * as React from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  /** Renders a lighter, inline variant (used inside cards). */
  compact?: boolean
}

/**
 * Shared empty / no-results / error placeholder.
 *
 * One component covers all three so a list never renders as a blank box: the
 * caller supplies the icon, the reason, and (optionally) the way out.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className
      )}
      {...props}
    >
      {icon ? (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
            compact ? "size-9" : "size-12"
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="max-w-md space-y-1">
        <p className={cn("font-bold text-foreground", compact ? "text-sm" : "text-base")}>{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}
