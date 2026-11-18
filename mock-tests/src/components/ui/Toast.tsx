"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Minimal toast system for the creator workspace.
 *
 * There is no toast library in `package.json`, and the CRUD flows only need
 * "saved / failed / deleted" feedback, so this is a small context provider with
 * auto-dismiss. Toasts stack from the bottom on phones (thumb reach) and from
 * the bottom-right on larger screens.
 */

type ToastTone = "success" | "error" | "info" | "warning"

interface Toast {
  id: number
  tone: ToastTone
  message: string
  description?: string
}

interface ToastContextValue {
  toast: (tone: ToastTone, message: string, description?: string) => void
  success: (message: string, description?: string) => void
  error: (message: string, description?: string) => void
  info: (message: string, description?: string) => void
  warning: (message: string, description?: string) => void
  dismiss: (id: number) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const TONE_STYLES: Record<ToastTone, { wrapper: string; icon: React.ReactNode }> = {
  success: {
    wrapper: "border-emerald-500/30 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-50",
    icon: <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />,
  },
  error: {
    wrapper: "border-destructive/30 bg-destructive/10 text-destructive-foreground",
    icon: <XCircle size={18} className="text-destructive" />,
  },
  warning: {
    wrapper: "border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50",
    icon: <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />,
  },
  info: {
    wrapper: "border-border bg-card text-card-foreground",
    icon: <Info size={18} className="text-primary" />,
  },
}

const AUTO_DISMISS_MS = 5000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const idRef = React.useRef(0)
  const timers = React.useRef<Map<number, number>>(new Map())

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = React.useCallback(
    (tone: ToastTone, message: string, description?: string) => {
      idRef.current += 1
      const id = idRef.current
      setToasts((current) => [...current.slice(-3), { id, tone, message, description }])
      const timer = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      timers.current.set(id, timer)
    },
    [dismiss]
  )

  React.useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (message, description) => push("success", message, description),
      error: (message, description) => push("error", message, description),
      info: (message, description) => push("info", message, description),
      warning: (message, description) => push("warning", message, description),
      dismiss,
    }),
    [push, dismiss]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col-reverse gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
      >
        {toasts.map((toast) => {
          const tone = TONE_STYLES[toast.tone]
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg",
                "animate-in fade-in-0 slide-in-from-bottom-2",
                tone.wrapper
              )}
            >
              <span className="mt-0.5 shrink-0">{tone.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold break-words">{toast.message}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs opacity-80 break-words">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="-mt-1 -mr-1 shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>.")
  }
  return context
}
