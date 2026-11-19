/**
 * Enquiry payload normalisation - the pure half of the support ingest path.
 *
 * WHY A SEPARATE MODULE
 *   `POST /api/enquiries` is the only unauthenticated write endpoint in the
 *   product that accepts free text from a stranger and stores it. Everything
 *   that decides *what is acceptable* is therefore worth being able to assert on
 *   without a database, a browser or a running server, which is what
 *   `scripts/enquiry.test.mts` does. The IO half lives in `./enquiries.ts`.
 *
 *   The same argument that split `sibling-rules.ts` from `sibling-offer.ts`:
 *   rules here, side effects there, so a rule change is a test change and not a
 *   live call.
 *
 * THE CLOSED TYPE LIST IS NOT DECORATION
 *   `public.enquiries.enquiry_type` carries a CHECK constraint with exactly these
 *   values, and 012's header states why the column is closed rather than free
 *   text: a free-text type column is how a message body ends up in a reportable
 *   table. `enquiry_type` is the ONLY value that reaches
 *   `reporting.fact_enquiry` as a topic, so an unvalidated string here would be
 *   the one way to get arbitrary parent-supplied text into the reporting schema
 *   without touching a restricted column at all. Anything the form cannot
 *   classify is 'other', and a human reads the body in the restricted table.
 *
 * LENGTHS
 *   Every cap here is generous against a real support message and small enough
 *   that a crafted POST cannot bloat a row. `messageBody` is the only free-text
 *   field, and it is written exclusively to `enquiry_contacts` - which has no
 *   policy for any role and no join path from `reporting`.
 */

/** Must match the CHECK constraint on public.enquiries.enquiry_type, verbatim. */
export const ENQUIRY_TYPES = [
  'billing',
  'technical',
  'privacy',
  'accessibility',
  'product_question',
  'refund',
  'complaint',
  'other',
] as const

export type EnquiryType = (typeof ENQUIRY_TYPES)[number]

export function isEnquiryType(value: unknown): value is EnquiryType {
  return typeof value === 'string' && (ENQUIRY_TYPES as readonly string[]).includes(value)
}

/**
 * The choices actually shown on the form.
 *
 * `other` is deliberately absent: it is the database's safety value for anything
 * a human classifies later, not an option offered up front. A form that invites
 * "Other" turns the closed list into a suggestion box and quietly degrades the
 * one column the reporting layer reads.
 */
export const ENQUIRY_TYPE_CHOICES: ReadonlyArray<{ value: EnquiryType; label: string }> = [
  { value: 'billing', label: 'Billing or a payment' },
  { value: 'refund', label: 'A refund' },
  { value: 'technical', label: 'Something is not working' },
  { value: 'accessibility', label: 'Accessibility' },
  { value: 'privacy', label: 'My data, or my child’s data' },
  { value: 'product_question', label: 'A question about the tests' },
  { value: 'complaint', label: 'A complaint' },
]

export const ENQUIRY_LIMITS = {
  fullNameMin: 2,
  fullNameMax: 120,
  emailMax: 254,
  phoneMax: 32,
  messageMin: 20,
  messageMax: 4000,
} as const

export interface NormalisedEnquiry {
  enquiryType: EnquiryType
  contact: {
    fullName: string
    email: string
    phone: string | null
    messageBody: string
  }
}

export type EnquiryValidation =
  | { ok: true; value: NormalisedEnquiry }
  | { ok: false; errors: Record<string, string> }

/** Trim, collapse internal whitespace runs, and cap. Returns '' for non-strings. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * A newline-preserving variant for the message body.
 *
 * `clean` above would flatten a five-paragraph complaint into one line, and a
 * support message is the one field a human genuinely reads. Control characters
 * other than \n and \r are still stripped, because a stray escape sequence in a
 * stored body is a rendering hazard for whoever opens the triage queue.
 */
function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max)
}

/**
 * The honeypot field name.
 *
 * Named after what a bot looks for rather than what a human would fill in, so a
 * naive crawler is more likely to complete it. A real visitor never sees it: the
 * form renders it `autocomplete="off"` and visually hidden. It is checked in the
 * ROUTE and never named in a validation error, because telling a bot which field
 * gave it away is an instruction.
 */
export const HONEYPOT_FIELD = 'company_website'

/** True when the submission should be discarded as bot traffic. */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const value = body[HONEYPOT_FIELD]
  if (value === undefined || value === null) return false
  if (typeof value !== 'string') return true
  return value.trim() !== ''
}

/**
 * Validate and normalise a submitted enquiry.
 *
 * Errors are keyed by form field so the client can attach each one to its input
 * rather than showing a sentence the user has to parse to find the problem.
 */
export function normaliseEnquiry(body: Record<string, unknown>): EnquiryValidation {
  const errors: Record<string, string> = {}

  const enquiryType = isEnquiryType(body.enquiryType) ? body.enquiryType : null
  if (!enquiryType) {
    errors.enquiryType = 'Please choose what your message is about.'
  }

  const fullName = clean(body.fullName, ENQUIRY_LIMITS.fullNameMax)
  if (fullName.length < ENQUIRY_LIMITS.fullNameMin) {
    errors.fullName = 'Please tell us your name.'
  }

  // Lower-cased and trimmed here rather than relying on citext: the column is
  // citext so it would normalise case anyway, but validating `a@b` before it
  // reaches the database means a typo never becomes a contact record that looks
  // plausible and cannot be replied to.
  const email = clean(body.email, ENQUIRY_LIMITS.emailMax).toLowerCase()
  if (!email) {
    errors.email = 'Please give us an email address so we can reply.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = 'That email address does not look right.'
  }

  // An empty phone is stored as NULL rather than '', so the triage list cannot
  // show "no phone number" as the string that a caller typed a space into.
  const phoneRaw = clean(body.phone, ENQUIRY_LIMITS.phoneMax)
  const phone = phoneRaw === '' ? null : phoneRaw

  const messageBody = cleanMultiline(body.message, ENQUIRY_LIMITS.messageMax)
  if (messageBody.length === 0) {
    errors.message = 'Please tell us how we can help.'
  } else if (messageBody.length < ENQUIRY_LIMITS.messageMin) {
    errors.message = `Please add a little more detail (at least ${ENQUIRY_LIMITS.messageMin} characters).`
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      enquiryType: enquiryType as EnquiryType,
      contact: { fullName, email, phone, messageBody },
    },
  }
}

/**
 * Shape of the `p_contact` object handed to public.ingest_enquiry().
 *
 * The key names are part of the database contract: `ingest_enquiry` reads
 * exactly these four out of the jsonb, in the same transaction that writes the
 * reportable row. Kept behind a function so a rename here fails the route at
 * compile time rather than silently writing a contact row of four NULLs - which
 * would be a support ticket with nothing in it to reply to.
 */
export function contactJsonb(value: NormalisedEnquiry['contact']): Record<string, string | null> {
  return {
    fullName: value.fullName,
    email: value.email,
    phone: value.phone,
    messageBody: value.messageBody,
  }
}

/**
 * Shape of `p_utm`. Only the five UTM keys `normalizeUtm()` in the funnel layer
 * recognises survive that function, so an enquiry and an event from the same
 * visitor carry identical attribution - which is the reason 012 put those
 * columns on `enquiries` instead of leaving channel data in the message body.
 */
export function utmJsonb(utm: Record<string, string> | null): Record<string, string> | null {
  return utm && Object.keys(utm).length > 0 ? utm : null
}

