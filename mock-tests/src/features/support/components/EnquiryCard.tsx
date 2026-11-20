"use client"

import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Field, Textarea } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import {
  SLA_META,
  SLA_META_UNKNOWN,
  ACTION_LABEL,
  typeLabel,
  outcomeLabel,
} from "@/lib/support/enquiry-labels"
import {
  ENQUIRY_OUTCOMES,
  actionNeedsOutcome,
  allowedActions,
  describeAge,
  responseKnowledge,
  taskReasonError,
  type EnquiryAction,
  type EnquiryOutcome,
  type EnquiryStatus,
} from "@/lib/support/triage"
import type { ContactPayload, EnquiryQueueRow } from "@/lib/support/triage-service"

/**
 * One enquiry in the support queue.
 *
 * WHY IT IS ITS OWN COMPONENT
 *   Three things have to be derived from the row and read together: the SLA
 *   chip, whether a reply was ever recorded, and which actions are currently
 *   legal. Inlined into the list they scatter across twelve JSX conditionals,
 *   which is exactly where a rule like "reply is unavailable once closed"
 *   becomes invisible and gets contradicted by a stray button.
 *
 * WHY THE MESSAGE BODY IS NOT IN THE LIST
 *   `admin_enquiry_queue()` has no contact column in its RETURNS clause, so
 *   the only way text like this reaches the screen is by calling
 *   `read_enquiry_contact(id, task_reason)`, which writes an audit row first.
 *   Requiring a reason is what makes that log meaningful rather than
 *   decorative. The second benefit is mundane and real: this screen gets opened
 *   on shared office displays, and a family's complaint should not be on the
 *   wall because someone scrolled to the wrong row.
 *
 * WHY ASSIGNMENT IS A NOTE RATHER THAN A BUTTON
 *   The action exists in the API and the state machine, but there is no people
 *   picker here yet, and letting an admin paste a UUID is not an interface.
 *   Saying "not in this UI" is accurate; a button that opens something nobody
 *   can fill in correctly is the same lie as offering an action the database
 *   would refuse.
 */
export interface EnquiryCardProps {
  row: EnquiryQueueRow
  busy: boolean
  contact?: ContactPayload
  pending: EnquiryAction | null
  revealing: boolean
  revealReason: string
  revealError: string | null
  revealBusy: boolean
  onAction: (id: string, action: EnquiryAction, outcome: EnquiryOutcome | null) => Promise<void>
  onAskOutcome: (p: { id: string; action: EnquiryAction } | null) => void
  onReveal: (id: string) => Promise<void>
  onRevealReasonChange: (v: string) => void
  onOpenReveal: (id: string) => void
  onCancelReveal: () => void
  onCancelOutcome: () => void
}

export function EnquiryCard({ row, ...p }: EnquiryCardProps) {
  const meta = SLA_META[row.sla_state] ?? SLA_META_UNKNOWN
  const knowledge = responseKnowledge({
    status: row.status as EnquiryStatus,
    first_response_at: row.first_response_at,
  })
  const actions = allowedActions({
    status: row.status as EnquiryStatus,
    first_response_at: row.first_response_at,
    resolved_at: row.resolved_at,
  })
  const reasonInvalid = taskReasonError(p.revealReason)

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {typeLabel(row.enquiry_type)}
            <span className="ml-2 font-normal text-muted-foreground">
              {row.channel}
              {row.utm_source ? ` · ${row.utm_source}` : ""}
            </span>
          </p>

          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{row.enquiry_id.slice(0, 8).toUpperCase()}</span>
            {" · received "}
            {new Date(row.received_at).toLocaleString("en-AU")}
            {" · waiting "}
            {describeAge(row.age_minutes)}
            {row.parent_user_id ? " · registered account" : " · no account linked"}
            {row.converted ? " · produced an order" : ""}
          </p>

          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{row.status}</Badge>
            <span className={`rounded-md border px-2 py-0.5 font-semibold ${meta.tone}`} title={meta.why}>
              {meta.text}
            </span>
            {knowledge === "recorded" ? (
              <span className="text-muted-foreground">
                replied in {describeAge(row.response_minutes)}
                {row.resolution_hours !== null ? ` · resolved in ${row.resolution_hours} h` : ""}
              </span>
            ) : knowledge === "missing" ? (
              <span className="text-muted-foreground">
                no reply on record — response time unknown, not zero
              </span>
            ) : null}
            {row.outcome ? (
              <span className="text-muted-foreground">outcome: {outcomeLabel(row.outcome)}</span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          {actions.map((a) =>
            actionNeedsOutcome(a) ? (
              <Button
                key={a}
                size="sm"
                variant="outline"
                disabled={p.busy}
                onClick={() => p.onAskOutcome({ id: row.enquiry_id, action: a })}
              >
                {ACTION_LABEL[a]}
              </Button>
            ) : a === "assign" ? (
              <span
                key={a}
                title="Assignment works through the API; this screen has no people picker yet."
                className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground"
              >
                Assign — not in this UI
              </span>
            ) : (
              <Button
                key={a}
                size="sm"
                variant={a === "spam" ? "ghost" : "default"}
                disabled={p.busy}
                onClick={() => void p.onAction(row.enquiry_id, a, null)}
              >
                {p.busy ? "…" : ACTION_LABEL[a]}
              </Button>
            )
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => (p.revealing ? p.onCancelReveal() : p.onOpenReveal(row.enquiry_id))}
          >
            {p.contact ? "Contact shown" : p.revealing ? "Cancel" : "Read contact"}
          </Button>
        </div>
      </div>

      {p.pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-slate-50 p-2">
          <label htmlFor={`o-${row.enquiry_id}`} className="text-xs font-semibold">
            Outcome for “{ACTION_LABEL[p.pending]}”
          </label>
          <Select
            id={`o-${row.enquiry_id}`}
            className="w-40"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as EnquiryOutcome
              if (v) void p.onAction(row.enquiry_id, p.pending as EnquiryAction, v)
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {ENQUIRY_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" onClick={p.onCancelOutcome}>
            Cancel
          </Button>
        </div>
      ) : null}

      {p.revealing && !p.contact ? (
        <div className="mt-3 rounded-lg border border-border bg-slate-50 p-2">
          <Field
            label="Why do you need these details?"
            htmlFor={`r-${row.enquiry_id}`}
            error={p.revealError}
            hint="Written to the access audit with your name and the time. Never ask for or send a password or card number."
          >
            <Textarea
              id={`r-${row.enquiry_id}`}
              rows={2}
              value={p.revealReason}
              onChange={(e) => p.onRevealReasonChange(e.target.value)}
              placeholder="e.g. Verifying identity before processing a refund request."
            />
          </Field>
          <Button
            size="sm"
            className="mt-2"
            disabled={p.revealBusy || reasonInvalid !== null}
            onClick={() => void p.onReveal(row.enquiry_id)}
          >
            {p.revealBusy ? "Reading…" : "Read and record"}
          </Button>
          {reasonInvalid ? (
            <p className="mt-1 text-xs text-muted-foreground">{reasonInvalid}</p>
          ) : null}
        </div>
      ) : null}

      {p.contact ? (
        <div className="mt-3 rounded-lg border border-border bg-white p-3 text-sm">
          <p className="font-semibold">{p.contact.full_name ?? "No name given"}</p>
          <p className="text-xs text-muted-foreground">
            {p.contact.email ?? "no email recorded"}
            {p.contact.phone ? ` · ${p.contact.phone}` : ""}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-slate-800">
            {p.contact.message_body ?? "No message body was recorded for this enquiry."}
          </p>
        </div>
      ) : null}
    </li>
  )
}


