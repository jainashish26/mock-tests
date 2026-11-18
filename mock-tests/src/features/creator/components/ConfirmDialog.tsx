'use client'

import * as React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/**
 * Confirmation step for destructive creator actions.
 *
 * Deletion cannot be undone (a test delete is refused while attempts exist, and
 * a question delete is refused while it is attached to a locked test), so the
 * dialog spells out exactly what is about to happen and keeps the API's error
 * message visible if the server refuses.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      size="sm"
      closeOnOverlay={!busy}
      footer={
        <>
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            className="min-h-11 w-full sm:w-auto"
            onClick={() => void onConfirm()}
            disabled={busy}
            data-autofocus
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : destructive ? <AlertTriangle size={16} /> : null}
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted-foreground">{description}</div>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
