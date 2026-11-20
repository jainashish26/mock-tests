import { ENQUIRY_TYPE_CHOICES } from './enquiry-fields'
import type { EnquiryAction, EnquiryOutcome, EnquiryStatus } from './triage'

/**
 * The words the support queue shows, in one module.
 *
 * WHY THE STRINGS ARE SEPARATE FROM THE COMPONENTS
 *   The queue header, the card, the A13 panel and any future email template all
 *   need to call `waiting_on_customer` the same thing to the same person. Duplic
 *   a label across two components and the third place that renders it becomes
 *   whichever one was written most recently.
 *
 *   `SLA_META` carries a `why` sentence alongside each tone because the states
 *   are genuinely non-obvious - "breached" includes enquiries nobody has
 *   answered yet, and "unrecorded" is not the same as "met". An operator who
 *   disagrees with a chip will read the sentence, and a report whose worst
 *   category is unexplained is a report that gets ignored. Each `why` is the
 *   §5.8 rule in plain language, not a restatement of the label.
 */

export const SLA_META: Record<string, { text: string; tone: string; why: string }> = {
  breached: {
    text: "Breached",
    tone: "bg-destructive/15 text-destructive border-destructive/40",
    why: "Replied late, or still unanswered past the window. Both count now: waiting for a breach to be resolved before it appears is how the worst cases never reach the screen meant to surface them.",
  },
  at_risk: {
    text: "At risk",
    tone: "bg-amber-100 text-amber-800 border-amber-300",
    why: "Open, inside the window, but past three quarters of it.",
  },
  within: {
    text: "Within",
    tone: "bg-emerald-100 text-emerald-800 border-emerald-300",
    why: "Open and comfortably inside the response window.",
  },
  met: {
    text: "Met",
    tone: "bg-emerald-100 text-emerald-800 border-emerald-300",
    why: "A first response is recorded and it was inside the window.",
  },
  unrecorded: {
    text: "Not recorded",
    tone: "bg-slate-100 text-slate-600 border-slate-300",
    why: "Closed or resolved with no first response ever recorded. The response time is unknown, not zero. A13 counts these separately rather than letting them flatter the average.",
  },
  unknown_calendar: {
    text: "No deadline",
    tone: "bg-slate-100 text-slate-600 border-slate-300 border-dashed",
    why: "The Victorian public-holiday calendar does not cover this enquiry's response window, so no deadline can be computed and the row is neither met nor breached. Fix by adding the missing year to reporting.dim_public_holiday_vic; refusing to guess is deliberate.",
  },
}

/**
 * Fallback for a state this build has never seen.
 *
 * It used to be `SLA_META.within`, which meant a new database state rendered as
 * "open and comfortably inside the response window" - the queue would have
 * advertised an all-clear for a condition it did not understand. Defaulting an
 * unknown to good news is the one failure direction a triage screen must not
 * have, so the fallback is deliberately as loud as a warning.
 */
export const SLA_META_UNKNOWN = {
  text: "Unrecognised state",
  tone: "bg-amber-100 text-amber-900 border-amber-400 border-dashed",
  why: "The queue returned an SLA state this build does not know. Treat the figure as unavailable, not as reassurance.",
}

export const ACTION_LABEL: Record<EnquiryAction, string> = {
  triage: "Triage",
  start: "Start",
  reply: "Record reply",
  resolve: "Resolve",
  close: "Close",
  reopen: "Reopen",
  assign: "Assign",
  spam: "Mark spam",
}

export const OUTCOME_LABEL: Record<EnquiryOutcome, string> = {
  answered: "Answered",
  refunded: "Refunded",
  escalated: "Escalated",
  no_action: "No action needed",
  spam: "Spam",
  duplicate: "Duplicate",
  withdrawn: "Withdrawn",
}

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  triaged: "Triage taken",
  in_progress: "In progress",
  waiting_on_customer: "Waiting on the family",
  resolved: "Resolved",
  closed: "Closed",
  spam: "Spam",
}

/**
 * Topic labels, derived from the form's own choice list rather than repeated
 * here, so a topic added to the closed enum appears in the queue without a
 * second edit. `other` is absent because it is never offered on the form and
 * the queue falls back to the raw value when a label is missing - which is
 * visible and odd, and better than silently hiding a category.
 */
export const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ENQUIRY_TYPE_CHOICES.map((c) => [c.value, c.label])
)

export function typeLabel(value: string): string {
  return TYPE_LABEL[value] ?? value
}

export function outcomeLabel(value: string | null): string {
  if (!value) return "—"
  return OUTCOME_LABEL[value as EnquiryOutcome] ?? value
}
