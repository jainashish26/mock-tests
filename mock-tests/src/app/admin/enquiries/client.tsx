"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"

import { EnquiryCard } from "@/features/support/components/EnquiryCard"
import { Button } from "@/components/ui/Button"
import { Field } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { TYPE_LABEL } from "@/lib/support/enquiry-labels"
import {
  ENQUIRY_STATUSES,
  slaCaveat,
  type EnquiryAction,
  type EnquiryOutcome,
  type EnquiryStatus,
} from "@/lib/support/triage"
import type {
  ContactPayload,
  EnquiryCounts,
  EnquiryQueueRow,
} from "@/lib/support/triage-service"

/**
 * The admin support queue.
 *
 * WHY THE ACTION BUTTONS ARE DERIVED, NOT DECLARED
 *   Each card renders `allowedActions(row)` from the shared vocabulary in
 *   `lib/support/triage.ts`, which mirrors the guards inside
 *   `admin_enquiry_transition`. The alternative - a fixed list of buttons per
 *   status - is a second state machine nobody tests against the first, and it
 *   fails in the direction that damages trust: the operator sees "Record
 *   reply" on an enquiry closed last week, clicks it, and is told no. A queue
 *   that lies about its own rows is worse than a queue with fewer buttons.
 *
 * NO OPTIMISTIC STATUS CHANGES
 *   A row moves only after the database says it moved. That function is the
 *   only writer of the response and resolution clocks, so a client that
 *   guessed the result would display a first-response time the server may have
 *   just refused to record.
 *
 * RELOAD RATHER THAN ARGUE
 *   Every action re-fetches, including the refusals. A 409 means another tab or
 *   another admin moved the row first; showing what the database holds is the
 *   only honest response, and it is why nothing here patches `rows` locally.
 */
export function EnquiryQueue() {
  const [rows, setRows] = useState<EnquiryQueueRow[]>([])
  const [counts, setCounts] = useState<EnquiryCounts | null>(null)
  const [status, setStatus] = useState<"" | EnquiryStatus>("")
  const [type, setType] = useState<"" | string>("")
  const [unansweredOnly, setUnansweredOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<{ id: string; action: EnquiryAction } | null>(null)
  const [revealed, setRevealed] = useState<Record<string, ContactPayload>>({})
  const [revealOpen, setRevealOpen] = useState<string | null>(null)
  const [revealReason, setRevealReason] = useState("")
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealBusy, setRevealBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams()
      if (status) q.set("status", status)
      if (type) q.set("type", type)
      if (unansweredOnly) q.set("unanswered", "1")
      q.set("limit", "100")

      const res = await fetch(`/api/admin/enquiries?${q.toString()}`)
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean
        rows?: EnquiryQueueRow[]
        counts?: EnquiryCounts
        error?: string
      } | null

      if (!res.ok || !payload?.ok) {
        setError(payload?.error ?? "The queue could not be loaded.")
        setRows([])
        setCounts(null)
      } else {
        setRows(payload.rows ?? [])
        setCounts(payload.counts ?? null)
      }
    } catch {
      setError("The queue could not be loaded. Check your connection.")
    } finally {
      setLoading(false)
    }
  }, [status, type, unansweredOnly])

  useEffect(() => {
    void load()
  }, [load])

  const caveat = useMemo(() => (counts ? slaCaveat(counts) : null), [counts])

  async function runAction(id: string, action: EnquiryAction, outcome: EnquiryOutcome | null) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/enquiries/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(outcome ? { outcome } : {}) }),
      })
      const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !payload?.ok) setError(payload?.error ?? "That change could not be saved.")
    } catch {
      setError("The change could not be saved. Check your connection.")
    } finally {
      // Reload whichever way it went, then clear the in-flight markers: the
      // rows were just replaced, so a busy flag keyed to an old row id would
      // grey out a card that is no longer in the state it was clicked from.
      await load()
      setBusyId(null)
      setPending(null)
    }
  }

  async function reveal(id: string) {
    setRevealBusy(true)
    setRevealError(null)
    try {
      const res = await fetch(`/api/admin/enquiries/${id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskReason: revealReason }),
      })
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean
        contact?: ContactPayload
        error?: string
      } | null

      if (!res.ok || !payload?.ok || !payload.contact) {
        setRevealError(payload?.error ?? "The contact details could not be read.")
        return
      }
      setRevealed((prev) => ({ ...prev, [id]: payload.contact as ContactPayload }))
      setRevealOpen(null)
      setRevealReason("")
    } catch {
      setRevealError("The contact details could not be read.")
    } finally {
      setRevealBusy(false)
    }
  }

  function cancelReveal() {
    setRevealOpen(null)
    setRevealReason("")
    setRevealError(null)
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6">
      {counts ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Open", value: counts.open_total, tone: "text-foreground" },
            { label: "Breached", value: counts.breached, tone: "text-destructive" },
            { label: "At risk", value: counts.at_risk, tone: "text-amber-700" },
            { label: "Reply not recorded", value: counts.unrecorded_open, tone: "text-slate-600" },
          ].map((cell) => (
            <div key={cell.label} className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">{cell.label}</p>
              <p className={`text-2xl font-bold ${cell.tone}`}>{cell.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {caveat ? (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {caveat}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Status" htmlFor="f-status" className="w-40">
          <Select
            id="f-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | EnquiryStatus)}
          >
            <option value="">All (not spam)</option>
            {ENQUIRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Topic" htmlFor="f-type" className="w-52">
          <Select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any topic</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 pb-2.5 text-sm font-medium">
          <input
            type="checkbox"
            checked={unansweredOnly}
            onChange={(e) => setUnansweredOnly(e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          No reply recorded
        </label>

        <Button variant="outline" onClick={() => void load()} disabled={loading} className="mb-0.5">
          <RefreshCw aria-hidden="true" />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">
          Nothing matches this view. An empty queue and an over-filtered queue
          look identical, so check the filters above before concluding the
          inbox is clear.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <EnquiryCard
              key={row.enquiry_id}
              row={row}
              busy={busyId === row.enquiry_id}
              contact={revealed[row.enquiry_id]}
              pending={pending?.id === row.enquiry_id ? pending.action : null}
              revealing={revealOpen === row.enquiry_id}
              revealReason={revealReason}
              revealError={revealError}
              revealBusy={revealBusy}
              onAction={runAction}
              onAskOutcome={setPending}
              onReveal={reveal}
              onRevealReasonChange={(v) => {
                setRevealReason(v)
                setRevealError(null)
              }}
              onOpenReveal={setRevealOpen}
              onCancelReveal={cancelReveal}
              onCancelOutcome={() => setPending(null)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

