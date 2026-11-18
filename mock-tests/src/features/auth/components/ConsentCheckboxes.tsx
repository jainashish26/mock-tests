'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { CONSENT_FIELDS, CONSENT_LINKS, type ConsentState } from '@/lib/auth/consent'

/**
 * Sign-up consent checkboxes for parent registration.
 *
 * Two mandatory confirmations (age 18+, and Terms of Service plus Privacy Policy
 * acknowledgement) and one optional marketing opt-in.
 *
 * Details that are easy to get wrong:
 *  - Each input has a real id and a label with htmlFor, so the whole sentence is
 *    the clickable target and screen readers announce it correctly.
 *  - The legal links sit inside those labels. Per the HTML spec, interactive
 *    content nested in a label does not forward activation to the labelled
 *    control, so clicking "Terms of Service" navigates rather than toggling.
 *  - Links open in a new tab so a parent can read the policy without losing a
 *    half-filled form.
 *  - Mandatory boxes use native required, which works with JavaScript disabled;
 *    the JS handler adds a specific message naming what is missing.
 *  - Nothing is pre-checked: consent must be an affirmative act.
 */

interface ConsentCheckboxesProps {
  value: ConsentState
  onChange: (next: ConsentState) => void
  /** Keys that failed validation on the last submit, used for aria-invalid. */
  invalidFields?: (keyof ConsentState)[]
  /** Message shown above the group when validation fails. */
  errorMessage?: string | null
  className?: string
}

const boxClass =
  'mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border border-border bg-card accent-[var(--primary)]'

const textClass =
  'text-[0.8125rem] leading-relaxed text-muted-foreground cursor-pointer select-none'

const linkClass =
  'font-semibold text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary'

const requiredTag =
  'ml-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-red-500'

const optionalTag =
  'ml-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground'

export function ConsentCheckboxes({
  value,
  onChange,
  invalidFields = [],
  errorMessage,
  className,
}: ConsentCheckboxesProps) {
  const set = (key: keyof ConsentState, checked: boolean) =>
    onChange({ ...value, [key]: checked })

  return (
    <fieldset
      className={className}
      aria-describedby={errorMessage ? 'consent-error' : undefined}
      style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
    >
      <legend className="sr-only">
        Registration confirmations. The first two are required.
      </legend>

      {errorMessage && (
        <div
          id="consent-error"
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[0.8125rem] font-medium text-red-600"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {/* Mandatory: age 18+ */}
        <div className="flex items-start gap-3">
          <input
            id={CONSENT_FIELDS.age}
            name={CONSENT_FIELDS.age}
            type="checkbox"
            required
            checked={value.ageConfirmed}
            onChange={(e) => set('ageConfirmed', e.target.checked)}
            aria-invalid={invalidFields.includes('ageConfirmed')}
            className={boxClass}
          />
          <label htmlFor={CONSENT_FIELDS.age} className={textClass}>
            By checking this box, you confirm you have reached the age of 18 years
            old.
            <span className={requiredTag}>Required</span>
          </label>
        </div>
        {/* Mandatory: Terms of Service + Privacy Policy */}
        <div className="flex items-start gap-3">
          <input
            id={CONSENT_FIELDS.terms}
            name={CONSENT_FIELDS.terms}
            type="checkbox"
            required
            checked={value.termsAccepted}
            onChange={(e) => set('termsAccepted', e.target.checked)}
            aria-invalid={invalidFields.includes('termsAccepted')}
            className={boxClass}
          />
          <label htmlFor={CONSENT_FIELDS.terms} className={textClass}>
            By checking this box, you agree to the{' '}
            <a
              href={CONSENT_LINKS.terms}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Terms of Service
            </a>
            , and acknowledge our{' '}
            <a
              href={CONSENT_LINKS.privacy}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Privacy Policy
            </a>
            .
            <span className={requiredTag}>Required</span>
          </label>
        </div>

        {/* Optional: product and exam-date updates */}
        <div className="flex items-start gap-3">
          <input
            id={CONSENT_FIELDS.marketing}
            name={CONSENT_FIELDS.marketing}
            type="checkbox"
            checked={value.marketingOptIn}
            onChange={(e) => set('marketingOptIn', e.target.checked)}
            className={boxClass}
          />
          <label htmlFor={CONSENT_FIELDS.marketing} className={textClass}>
            By checking this box, I would like to receive occasional emails about
            new practice tests, exam dates and study resources.
            <span className={optionalTag}>Optional</span>
          </label>
        </div>
      </div>

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-slate-400">
        We record your confirmation, the consent version and the date so we can
        show what you agreed to. You can withdraw the optional email preference at
        any time - see our{' '}
        <Link href={CONSENT_LINKS.privacy} className="font-semibold text-primary hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </fieldset>
  )
}