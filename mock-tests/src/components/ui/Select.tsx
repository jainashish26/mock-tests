import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Native `<select>` styled to match `Input`.
 *
 * A native control is deliberate: Radix Select is not installed, and the OS
 * picker is the best experience on touch devices (it opens the platform sheet
 * instead of a small scrollable popover).
 *
 * The wrapper is not `w-full`: inside a `Field` (a flex column) it stretches to
 * the full width anyway, while in a flex *row* - such as a list row's action bar -
 * it stays content-sized so it cannot push the buttons off screen. Pass `w-full`
 * through `className` when a row layout should still fill the space.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm text-foreground shadow-xs transition-colors",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { Select }
