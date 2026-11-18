import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Form primitives shared by the creator workspace.
 *
 * Kept as plain, uncontrolled-friendly inputs (they forward `defaultValue` and
 * `name`) so the existing editors can submit a `FormData` payload without a
 * state library, while still picking up the design tokens.
 */

const fieldStyles =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldStyles, "h-10", className)} {...props} />
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldStyles, "min-h-20 resize-y py-2", className)}
      {...props}
    />
  )
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-sm font-semibold text-foreground select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}

interface FieldProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  required?: boolean
  htmlFor?: string
}

/** Label + control + hint/error wrapper so every form row lines up the same way. */
function Field({ label, hint, error, required, htmlFor, className, children, ...props }: FieldProps) {
  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p data-slot="field-error" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p data-slot="field-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-4 shrink-0 rounded border-input accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className
      )}
      {...props}
    />
  )
}

export { Input, Textarea, Label, Field, Checkbox, fieldStyles }
