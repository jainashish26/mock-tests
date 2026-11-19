"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Send } from "lucide-react"

import { Button } from "@/components/ui/Button"
import { Field, Input, Textarea } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { ENQUIRY_LIMITS, ENQUIRY_TYPE_CHOICES, HONEYPOT_FIELD } from "@/lib/support/enquiry-fields"

/**
 * The public support form (backlog item 21).
 *
 * WHY IT REPLACES THE MAILTO RATHER THAN SITTING BESIDE IT
 *   The contact page was email-only, which costs the business twice: nothing is
 *   recorded, so A13 can never be built, and a refund or privacy request that
 *   arrives in a shared inbox has no receipt, no status and no response clock.
 *   The page already promises a reply within one business day, and a promise with
 *   no record behind it is not a promise.
 *
 *   The mailto links stay. Two reasons, both practical: a form that needs
 *   JavaScript is a support channel that fails silently for anyone with scripts
 *   blocked, and the address is also the fallback the throttled copy points at.
 *   This component renders the address under the submit control rather than
 *   pretending it does not exist.
 *
 * NO CLIENT-SIDE VALIDATION LIBRARY
 *   Field errors come back from the route, keyed by field name, because the
 *   authoritative rules live server-side (they must - the same endpoint is
 *   reachable without this form ever loading). Duplicating length caps here would
 *   produce two rules that drift.
 *
 * THE HONEYPOT
 *   Rendered, but not to a person: visually hidden, `tabIndex={-1}`,
 *   `aria-hidden` and `autoComplete="off"`, so it is out of the tab order and out
 *   of the accessibility tree. A screen-reader user must never be asked to fill
 *   in a field called "company website" that nobody can see - that is precisely
 *   the accessibility failure an anti-abuse field invites.
 */

interface EnquiryFormProps {
  supportEmail: string
  responseTime: string
}

type SubmitState = "idle" | "sending" | "sent"

/** Read the five UTM keys off the current URL. The route normalises them again. */
function utmFromSearch(search: string): Record<string, string> | null {
  const params = new URLSearchParams(search)
  const out: Record<string, string> = {}
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = params.get(key)?.trim().slice(0, 200)
    if (value) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Human-friendly wait message from a Retry-After in seconds. */
function describeWait(seconds: number): string {
  if (seconds < 60) return "about a minute"
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? "" : "s"}`
}

interface ResponsePayload {
  ok?: boolean
  reference?: string | null
  error?: string
  fields?: Record<string, string>
  retryAfterSeconds?: number
}


export function EnquiryForm({ supportEmail, responseTime }: EnquiryFormProps) {
  const [state, setState] = useState<SubmitState>("idle")
  const [reference, setReference] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [messageLength, setMessageLength] = useState(0)

  /**
   * The token is fetched, not passed in, so /contact can stay a static page.
   * `null` means "not yet", `undefined` means "could not be obtained" - and the
   * two render differently, because a form that will certainly be refused at
   * submission must say so before someone writes a paragraph into it.
   */
  const [formToken, setFormToken] = useState<string | null | undefined>(null)

  // Focus moves to the status region on failure, so a keyboard and screen-reader
  // user is told what happened instead of being left on a button that did nothing.
  const statusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    fetch("/api/enquiries")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { formToken?: string | null } | null) => {
        if (cancelled) return
        setFormToken(typeof payload?.formToken === "string" ? payload.formToken : undefined)
      })
      .catch(() => {
        if (!cancelled) setFormToken(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [])

  function focusStatus() {
    // Deferred so the element exists in its new state before focus lands on it.
    requestAnimationFrame(() => statusRef.current?.focus())
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === "sending") return

    const form = event.currentTarget
    const data = new FormData(form)
    const body: Record<string, unknown> = {
      formToken: formToken ?? null,
      enquiryType: data.get("enquiryType"),
      fullName: data.get("fullName"),
      email: data.get("email"),
      phone: data.get("phone"),
      message: data.get("message"),
      [HONEYPOT_FIELD]: data.get(HONEYPOT_FIELD),
      utm: typeof window === "undefined" ? null : utmFromSearch(window.location.search),
    }

    setState("sending")
    setErrors({})
    setFormError(null)

    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const payload = (await res.json().catch(() => null)) as ResponsePayload | null

      if (res.ok && payload?.ok) {
        // The honeypot discard path and a real success look identical from here,
        // which is the point: nothing on this page tells a bot anything.
        setReference(payload.reference ?? null)
        setState("sent")
        form.reset()
        setMessageLength(0)
        focusStatus()
        return
      }

      if (res.status === 429 && payload?.retryAfterSeconds) {
        setFormError(
          `You have sent several messages already. Please wait ${describeWait(
            payload.retryAfterSeconds
          )} before trying again, or email ${supportEmail}.`
        )
        setState("idle")
        focusStatus()
        return
      }

      if (payload?.fields) {
        setErrors(payload.fields)
      }
      setFormError(payload?.error ?? "Your message could not be sent. Please try again.")
      setState("idle")
      focusStatus()
    } catch {
      // A network failure is described as such, because the honest difference
      // between "we refused it" and "it never reached us" is what tells a person
      // whether to retry or switch to email.
      setFormError("We could not reach the server. Please check your connection and try again.")
      setState("idle")
      focusStatus()
    }
  }

  if (state === "sent") {
    return (
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-xl border border-border bg-card p-5 shadow-xs outline-none"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h3 className="text-base font-semibold text-foreground">Message received</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              We aim to reply within {responseTime}. Keep the reference below for you — you can
              quote it in any follow-up.
            </p>
            {reference ? (
              <p className="mt-3 font-mono text-sm font-semibold text-foreground">
                Reference: {reference}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-muted-foreground">
              Urgent, or would rather write directly?{" "}
              <a
                className="font-medium text-primary underline underline-offset-4"
                href={`mailto:${supportEmail}`}
              >
                Email {supportEmail}
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    )
  }



  // A form that will certainly be refused should not invite a paragraph of
  // writing first. This is the rare path — the token endpoint failing means
  // something is wrong with the deploy, not with the visitor.
  if (formToken === undefined) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-card p-5 text-sm shadow-xs"
      >
        <p className="font-semibold text-foreground">The message form is unavailable.</p>
        <p className="mt-1 text-muted-foreground">
          Please email{" "}
          <a
            className="font-medium text-primary underline underline-offset-4"
            href={`mailto:${supportEmail}`}
          >
            {supportEmail}
          </a>{" "}
          and we will reply within {responseTime}.
        </p>
      </div>
    )
  }


  const showError = (key: string) => errors[key] ?? null

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError ? (
        <div
          ref={statusRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive outline-none"
        >
          {formError}
        </div>
      ) : null}

      <Field label="What is your message about?" required htmlFor="enquiryType" error={showError("enquiryType")}>
        <Select
          id="enquiryType"
          name="enquiryType"
          defaultValue=""
          required
          aria-invalid={showError("enquiryType") ? true : undefined}
        >
          <option value="" disabled>
            Choose a topic
          </option>
          {ENQUIRY_TYPE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required htmlFor="fullName" error={showError("fullName")}>
          <Input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            maxLength={ENQUIRY_LIMITS.fullNameMax}
            required
            aria-invalid={showError("fullName") ? true : undefined}
          />
        </Field>

        <Field
          label="Email for our reply"
          required
          htmlFor="email"
          error={showError("email")}
          hint="We use it only to answer this enquiry."
        >
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={ENQUIRY_LIMITS.emailMax}
            required
            aria-invalid={showError("email") ? true : undefined}
          />
        </Field>
      </div>

      <Field
        label="Phone (optional)"
        htmlFor="phone"
        hint="Only if you would rather we called about something urgent."
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={ENQUIRY_LIMITS.phoneMax}
        />
      </Field>

      <Field
        label="How can we help?"
        required
        htmlFor="message"
        error={showError("message")}
        hint={`${messageLength} / ${ENQUIRY_LIMITS.messageMax} characters`}
      >
        <Textarea
          id="message"
          name="message"
          rows={6}
          minLength={ENQUIRY_LIMITS.messageMin}
          maxLength={ENQUIRY_LIMITS.messageMax}
          required
          aria-invalid={showError("message") ? true : undefined}
          onChange={(event) => setMessageLength(event.currentTarget.value.length)}
        />
      </Field>

      {/*
        The honeypot. aria-hidden plus tabIndex -1 keep it out of both the
        accessibility tree and the tab order. It is positioned off-screen rather
        than display:none, because a crawler that walks the DOM is more likely to
        treat an off-screen input as a real field worth filling.
      */}
      <div
        aria-hidden="true"
        className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor={HONEYPOT_FIELD}>Company website</label>
        <Input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="submit" disabled={state === "sending" || formToken === null}>
          <Send aria-hidden="true" />
          {state === "sending" ? "Sending…" : formToken === null ? "Loading…" : "Send message"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Prefer email?{" "}
          <a
            className="font-medium text-primary underline underline-offset-4"
            href={`mailto:${supportEmail}`}
          >
            {supportEmail}
          </a>
        </p>
      </div>
    </form>
  )
}
