import { Badge } from "@/components/ui/Badge"
import { STATUS_HINTS, statusBadge, statusLabel } from "@/lib/creator/content-meta"
import type { ContentStatus } from "@/lib/creator/content-meta"
import { cn } from "@/lib/utils"

/**
 * Status pill for tests and questions.
 *
 * The variant/label mapping lives in `content-meta.ts` so the API routes and the
 * UI can never drift apart. `title` carries the plain-English rule (what a
 * creator may still do), which is otherwise invisible on a narrow screen.
 */
export function StatusBadge({
  status,
  className,
  withHint = true,
}: {
  status: string | null | undefined
  className?: string
  withHint?: boolean
}) {
  const hint = STATUS_HINTS[status as ContentStatus]

  return (
    <Badge
      variant={statusBadge(status)}
      title={withHint && hint ? hint : undefined}
      className={cn("whitespace-nowrap text-[0.6875rem] font-bold tracking-wide uppercase", className)}
    >
      {statusLabel(status)}
    </Badge>
  )
}
