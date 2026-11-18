'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Label, Textarea } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

import { updateAdminSettings } from './actions'

export interface AdminSettingsValues {
  maintenanceMode: boolean
  maintenanceMessage: string
  registrationOpen: boolean
}

/** Accessible on/off switch — a `role="switch"` button with a visible knob. */
function SettingToggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-hint`}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          checked ? 'bg-primary' : 'bg-input'
        }`}
      >
        <span className="sr-only">{label}</span>
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block size-5 -translate-y-px rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

/**
 * Platform settings form (ADMIN only).
 *
 * Edits the singleton admin_settings row through the updateAdminSettings
 * server action: maintenance mode + message and open registration. Shows an
 * "unsaved changes" hint while dirty and toast feedback after saving.
 */
export function SettingsForm({ initial }: { initial: AdminSettingsValues }) {
  const toast = useToast()
  const [maintenanceMode, setMaintenanceMode] = React.useState(initial.maintenanceMode)
  const [maintenanceMessage, setMaintenanceMessage] = React.useState(initial.maintenanceMessage)
  const [registrationOpen, setRegistrationOpen] = React.useState(initial.registrationOpen)
  const [saving, setSaving] = React.useState(false)

  const dirty =
    maintenanceMode !== initial.maintenanceMode ||
    maintenanceMessage !== initial.maintenanceMessage ||
    registrationOpen !== initial.registrationOpen

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const result = await updateAdminSettings({
        maintenanceMode,
        maintenanceMessage,
        registrationOpen,
      })
      if (result.ok) {
        toast.success('Settings saved', 'Platform settings were updated.')
      } else {
        toast.error('Could not save settings', result.error)
      }
    } catch (error) {
      toast.error('Could not save settings', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Platform settings">
      <SettingToggle
        id="maintenance-mode"
        label="Maintenance mode"
        hint="Flag the platform as under maintenance for everyone."
        checked={maintenanceMode}
        onChange={setMaintenanceMode}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="maintenance-message">Maintenance message</Label>
        <Textarea
          id="maintenance-message"
          rows={3}
          value={maintenanceMessage}
          onChange={(event) => setMaintenanceMessage(event.target.value)}
          placeholder="We're making improvements — back soon."
          aria-describedby="maintenance-message-hint"
        />
        <p id="maintenance-message-hint" className="text-xs text-muted-foreground">
          Notice shown alongside maintenance mode.
        </p>
      </div>

      <SettingToggle
        id="registration-open"
        label="Open registration"
        hint="Allow new students and parents to create accounts."
        checked={registrationOpen}
        onChange={setRegistrationOpen}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={saving} className="min-h-10 gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          Save settings
        </Button>
        {dirty && !saving ? (
          <p className="text-xs text-muted-foreground" role="status">
            Unsaved changes
          </p>
        ) : null}
      </div>
    </form>
  )
}
