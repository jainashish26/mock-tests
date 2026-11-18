import { CONTACT, SITE_NAME } from '@/lib/seo/site-config'
import {
  callout,
  ctaButton,
  daysRemaining,
  emailLayout,
  esc,
  formatDeadline,
  h2,
  link,
  listRow,
  listTable,
  money,
  EMAIL_COLOURS,
} from './layout'

/**
 * The lifecycle email templates.
 *
 * Each function returns a complete message plus the `template`/`dedupeKey`
 * pair that makes delivery exactly-once (see `email_log` in migration 011).
 * Returning the dedupe key from the template rather than having the caller
 * invent it is deliberate: the key must be stable across retries, and a caller
 * that generated it from `Date.now()` would silently defeat idempotency.
 */

export interface EmailMessage {
  subject: string
  html: string
  text: string
  template: string
  dedupeKey: string
  preheader: string
}

const { INK, SUCCESS, WARNING, DANGER, MUTED, BRAND } = EMAIL_COLOURS

/** Colour a band so a parent can read the report at a glance. */
function bandColour(score: number): string {
  if (score < 50) return DANGER
  if (score < 75) return WARNING
  return SUCCESS
}

/** "Fractions - 43% correct" -> [label, value], for a two-column row. */
function splitGapLine(line: string): [string, string] {
  const index = line.indexOf(' - ')
  if (index === -1) return [line, '']
  return [line.slice(0, index), line.slice(index + 3)]
}

/** The gap/strength list, as an email table. */
function topicList(lines: string[], colour: string): string {
  return listTable(
    lines.map((line) => {
      const [label, value] = splitGapLine(line)
      return listRow(label, value, colour)
    })
  )
}

// =============================================================================
// STEP 4 - READINESS REPORT
// =============================================================================
export interface ReadinessEmailInput {
  userId: string
  childLabel: string
  yearLevel: number
  overallScore: number
  overallBand: string
  primaryExam: string
  primaryScore: number
  primaryBand: string
  confidence: string
  summary: string
  gapLines: string[]
  strengthLines: string[]
  questionsAnswered: number
  attemptsUsed: number
  readinessUrl: string
}

/**
 * The single most important email in the funnel.
 *
 * It asks for nothing. The only CTA is "see the full report", which is the
 * natural next action rather than a sales pitch. Every conversion later in the
 * funnel is paid for by how much genuine value this one delivers - which is why
 * the gaps and strengths are in the email body itself and not hidden behind the
 * click. An email that withholds its own content to farm a click is an email
 * that trains the parent to distrust the next four.
 */
export function readinessReportEmail(input: ReadinessEmailInput): EmailMessage {
  const scoreColour = bandColour(input.primaryScore)
  const topGap = input.gapLines[0] ? splitGapLine(input.gapLines[0])[0] : 'The full diagnosis'
  const preheader = `${topGap} is the topic costing ${input.childLabel} the most marks right now.`
  const attemptPhrase =
    input.attemptsUsed === 1
      ? 'their first benchmark assessment'
      : `${input.attemptsUsed} benchmark assessments`

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
${esc(input.childLabel)} has completed ${esc(attemptPhrase)} &mdash; ${input.questionsAnswered} questions in total. Here is what the results say.
</p>

${callout(`
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td style="vertical-align:middle;">
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">
${esc(input.primaryExam)} readiness
</div>
<div style="font-size:40px;font-weight:800;line-height:1;color:${scoreColour};letter-spacing:-0.03em;">
${input.primaryScore}<span style="font-size:20px;color:${MUTED};font-weight:600;">/100</span>
</div>
<div style="font-size:14px;font-weight:700;color:${INK};margin-top:6px;">Band: ${esc(input.primaryBand)}</div>
</td>
<td align="right" style="vertical-align:middle;">
<div style="font-size:12px;color:${MUTED};max-width:170px;line-height:1.5;">${esc(input.confidence)}</div>
</td>
</tr>
</table>
`, scoreColour)}

<p style="margin:0 0 20px;">${esc(input.summary)}</p>

${
  input.gapLines.length > 0
    ? `${h2('Where the marks are being lost')}
<p style="margin:0 0 8px;color:${MUTED};font-size:14px;">
Topics ${esc(input.childLabel)} scored below 75% on. Fixing the top one moves an exam band further than anything else on this list.
</p>
${topicList(input.gapLines, DANGER)}`
    : `${h2('No significant gaps detected')}
<p style="margin:0 0 20px;">
Every topic ${esc(input.childLabel)} attempted is at or above 75%. The next step is harder content rather than remediation.
</p>`
}

${
  input.strengthLines.length > 0
    ? `${h2('What is already solid')}${topicList(input.strengthLines, SUCCESS)}`
    : ''
}

<p style="margin:20px 0 0;color:${MUTED};font-size:13px;">
The full report adds time-per-question diagnostics, question-level review, the progress trend across attempts and an adaptive study plan &mdash; the parts that turn a diagnosis into a schedule.
</p>

${ctaButton(input.readinessUrl, 'See the full readiness report')}
`

  return {
    subject: `${input.childLabel}'s exam readiness: ${input.primaryBand} (${input.primaryScore}/100)`,
    preheader,
    html: emailLayout({
      preheader,
      body,
      userId: input.userId,
      footerNote:
        "Generated from your child's own answers. Nothing is compared against other families unless cohort percentiles are enabled.",
    }),
    text: buildReadinessText(input),
    template: 'readiness_report',
    // One report per child, so a parent with three children correctly gets three.
    dedupeKey: `child:${input.childLabel}`,
  }
}

/** Plain-text alternative, written rather than stripped so it still reads well. */
function buildReadinessText(input: ReadinessEmailInput): string {
  const lines = [
    `${input.childLabel} has completed ${input.attemptsUsed} benchmark assessment(s) - ${input.questionsAnswered} questions in total.`,
    '',
    `${input.primaryExam} readiness: ${input.primaryScore}/100 (Band: ${input.primaryBand})`,
    `Confidence: ${input.confidence}`,
    '',
    input.summary,
    '',
  ]

  if (input.gapLines.length > 0) {
    lines.push('WHERE THE MARKS ARE BEING LOST:')
    lines.push(...input.gapLines.map((line) => `  - ${line}`))
  } else {
    lines.push('No significant gaps detected.')
  }

  if (input.strengthLines.length > 0) {
    lines.push('', 'WHAT IS ALREADY SOLID:')
    lines.push(...input.strengthLines.map((line) => `  - ${line}`))
  }

  lines.push(
    '',
    'Full report (time per question, question review, trend, adaptive plan):',
    input.readinessUrl
  )
  return lines.join('\n')
}


// =============================================================================
// STEP 5 - SECOND SESSION (surprise free mock, 7-day deadline)
// =============================================================================
export interface SecondSessionEmailInput {
  userId: string
  childLabel: string
  testTitle: string
  timeLimitMins: number
  expiresAt: string
  startUrl: string
}

/**
 * Reciprocity plus a deadline - the two mechanisms that make this step work.
 *
 * "Surprise" matters: an expected free test is a feature, an unexpected one is
 * a gift, and gifts create obligation. The 7-day window matters equally,
 * because an open-ended gift is never used. Both are in the subject line rather
 * than buried in the body, since the subject is the only part guaranteed to be
 * read.
 */
export function secondSessionEmail(input: SecondSessionEmailInput): EmailMessage {
  const days = daysRemaining(input.expiresAt)
  const preheader = `A full-length ${input.testTitle} is unlocked on your account for the next ${days} days. No payment details needed.`

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
We have unlocked a <strong>full-length mock exam</strong> on ${esc(input.childLabel)}'s account. It is free, it is already there, and we are not asking for payment details.
</p>

${callout(`
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Unlocked for ${esc(input.childLabel)}</div>
<div style="font-size:19px;font-weight:800;color:${INK};line-height:1.3;margin-bottom:8px;">${esc(input.testTitle)}</div>
<div style="font-size:14px;color:${MUTED};">${input.timeLimitMins} minutes &middot; exam conditions &middot; AI-marked</div>
`, BRAND)}

<p style="margin:0 0 16px;">
Why a second paper so soon? One diagnostic tells you where ${esc(input.childLabel)} stands today. Two, sat a few days apart, tell you whether the gaps in your readiness report are stable or whether they were a bad day. That distinction changes what you do next.
</p>

${callout(`
<div style="font-size:14px;font-weight:700;color:${WARNING};margin-bottom:4px;">
Available until ${esc(formatDeadline(input.expiresAt))}
</div>
<div style="font-size:13px;color:${MUTED};">
That is ${days} ${days === 1 ? 'day' : 'days'} from now. After that the paper returns to the paid catalogue &mdash; we keep the free window open long enough to be useful, not long enough to be forgotten.
</div>
`, WARNING)}

<p style="margin:20px 0 0;color:${MUTED};font-size:13px;">
Best sat in one sitting with the timer running, the way the real exam works. A paused-and-resumed attempt does not produce a useful time diagnostic.
</p>

${ctaButton(input.startUrl, 'Start the free mock exam')}
`

  return {
    subject: `Free for ${days} days: a full ${input.testTitle} for ${input.childLabel}`,
    preheader,
    html: emailLayout({ preheader, body, userId: input.userId }),
    text: [
      `We have unlocked a full-length mock exam on ${input.childLabel}'s account. It is free and no payment details are needed.`,
      '',
      `  ${input.testTitle}`,
      `  ${input.timeLimitMins} minutes, exam conditions, AI-marked`,
      '',
      `Available until ${formatDeadline(input.expiresAt)} (${days} days).`,
      'After that the paper returns to the paid catalogue.',
      '',
      'Why a second paper so soon? One diagnostic tells you where your child',
      'stands today. Two, sat a few days apart, tell you whether the gaps in',
      'your readiness report are stable or were a bad day.',
      '',
      'Start here:',
      input.startUrl,
    ].join('\n'),
    template: 'second_session',
    dedupeKey: `grant:${input.expiresAt.slice(0, 10)}`,
  }
}


// =============================================================================
// STEP 6 - NATURAL PAYWALL (after 2 completed tests)
// =============================================================================
export interface PaywallEmailInput {
  userId: string
  childLabel: string
  completedAttempts: number
  /** The specific insights now withheld, named concretely rather than vaguely. */
  lockedItems: string[]
  /** A real number from the child's own data - the hook. */
  teaserStat: string
  reportUrl: string
  upgradeUrl: string
}

/**
 * The paywall email. Sent exactly once, on the second completed test.
 *
 * The mechanic is the Zeigarnik effect: an incomplete task is remembered, and
 * it itches. The parent has started something - they have a diagnosis - and this
 * email shows them the specific next step they cannot take. That is far more
 * effective than a generic "upgrade for premium features", which is why
 * `lockedItems` is a list of named, data-specific insights rather than a
 * marketing bullet list.
 *
 * `teaserStat` must be a real figure from the child's own attempts. A paywall
 * built on a number the parent can verify is credible; one built on a vague
 * claim is not. Credibility is the only thing standing between this email and
 * the spam folder in the parent's mind.
 */
export function paywallEmail(input: PaywallEmailInput): EmailMessage {
  const preheader = `${input.teaserStat} - and there are more diagnostics on ${input.childLabel}'s last paper that the free report does not show.`

  const lockedRows = input.lockedItems
    .map(
      (item) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:${INK};">` +
        `<span style="color:${MUTED};font-weight:700;margin-right:8px;">&#128274;</span>${esc(item)}` +
        `</td></tr>`
    )
    .join('')

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
${esc(input.childLabel)} has now completed <strong>${input.completedAttempts} full assessments</strong>. That is enough data for the platform to start saying something genuinely useful, and enough for us to be honest about which parts of it you can see.
</p>

${callout(`
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">From the latest paper</div>
<div style="font-size:22px;font-weight:800;color:${INK};line-height:1.3;">${esc(input.teaserStat)}</div>
`, BRAND)}

${h2('What the free report stops at')}
<p style="margin:0 0 10px;color:${MUTED};font-size:14px;">
These are calculated for every attempt and are sitting in ${esc(input.childLabel)}'s record right now. They are not visible on the free tier:
</p>
${listTable(lockedRows)}

<p style="margin:20px 0 0;">
None of this is a judgement on where ${esc(input.childLabel)} is. It is the difference between knowing <em>that</em> a topic is weak and knowing <em>why</em> &mdash; whether it is a knowledge gap, a reading-speed problem, or a habit of rushing the last five questions. Those three have completely different fixes, and only the locked diagnostics tell you which one you are dealing with.
</p>

${ctaButton(input.reportUrl, 'Open the report')}

<p style="margin:0 0 8px;text-align:center;font-size:14px;">
Ready for the full picture? <a href="${esc(input.upgradeUrl)}" style="color:${BRAND};font-weight:700;text-decoration:underline;">See what unlocking everything includes</a>
</p>
`

  return {
    subject: `${input.childLabel} has finished ${input.completedAttempts} papers - here is what we can now tell you`,
    preheader,
    html: emailLayout({
      preheader,
      body,
      userId: input.userId,
      footerNote:
        'We send this once, on the second completed assessment. We will not keep emailing you about it.',
    }),
    text: [
      `${input.childLabel} has now completed ${input.completedAttempts} full assessments.`,
      '',
      `From the latest paper: ${input.teaserStat}`,
      '',
      'WHAT THE FREE REPORT STOPS AT',
      'These are calculated for every attempt and are not visible on the free tier:',
      ...input.lockedItems.map((item) => `  - ${item}`),
      '',
      'It is the difference between knowing that a topic is weak and knowing why:',
      'a knowledge gap, a reading-speed problem, or rushing the last five questions.',
      'Those three have completely different fixes.',
      '',
      'Open the report:',
      input.reportUrl,
      '',
      'See what unlocking everything includes:',
      input.upgradeUrl,
    ].join('\n'),
    template: 'paywall',
    // Sent once per family, ever. The spec says "after 2 completed tests" -
    // re-sending on the third, fourth and fifth is how a funnel trains its own
    // users to ignore it.
    dedupeKey: 'first',
  }
}


// =============================================================================
// STEP 7 - THE OFFER (Exam Pack / Core annual, one-time $150, 14-day guarantee)
// =============================================================================
export interface OfferEmailInput {
  userId: string
  childLabel: string
  offerName: string
  /** What the parent gets, as concrete lines. Vague benefits do not sell. */
  includes: string[]
  offerAmountCents: number
  originalAmountCents: number
  currency: string
  guaranteeDays: number
  expiresAt: string
  checkoutUrl: string
  /** The child's own headline gap, so the offer ties back to their diagnosis. */
  primaryGap: string | null
  primaryExam: string
}

/**
 * FOUR THINGS DO THE WORK IN THIS EMAIL, IN ORDER:
 *
 * 1. Anchoring. The struck-through original price is what makes $150 read as a
 *    deal rather than a cost. A price presented alone has no reference point, so
 *    the parent supplies one - usually a tutor's hourly rate, which is not
 *    flattering. The discount percentage is derived from the two stored amounts
 *    and never typed in, so it cannot contradict them.
 *
 * 2. Risk reversal. The 14-day guarantee sits directly under the price, in the
 *    same visual block. It is the answer to the question the price raises, so
 *    separating them wastes it. Digital goods are the highest-anxiety purchase
 *    there is - the parent cannot inspect first - and a guarantee is the only
 *    thing that substitutes for inspection.
 *
 * 3. Specificity. `includes` must be concrete and countable ("6 full papers",
 *    not "unlimited practice"). A parent evaluating $150 is doing arithmetic
 *    against a tutor; giving them units lets them do that arithmetic and win.
 *
 * 4. A real deadline. Generic urgency is ignored. A stored per-user expiry is
 *    not, because it does not reset when the tab is closed.
 *
 * This email is where the spec's "40%+ of users who reach step 5" target is won
 * or lost. It only goes to parents who have already sat two papers, so the copy
 * assumes the demonstration has happened and does not re-argue it.
 */

/** Inclusion list, as an email table with tick marks. */
function includesTable(items: string[]): string {
  return listTable(
    items
      .map(
        (item) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:${INK};">` +
          `<span style="color:${SUCCESS};font-weight:800;margin-right:8px;">&#10003;</span>${esc(item)}` +
          `</td></tr>`
      )
      .join('')
  )
}

/**
 * The guarantee block.
 *
 * The wording is deliberately unconditional - "no form, no interrogation". A
 * guarantee hedged with conditions is not risk reversal, it is a reminder that
 * there is risk. The conditions belong in /terms, which this links to; putting
 * them here would defeat the purpose of showing the guarantee at all.
 */
function guaranteeCallout(guaranteeDays: number, childLabel: string): string {
  return callout(`
<div style="font-size:14px;font-weight:800;color:${SUCCESS};margin-bottom:6px;">
${guaranteeDays}-day money-back guarantee
</div>
<div style="font-size:13px;color:${MUTED};line-height:1.6;">
Use it properly for ${guaranteeDays} days. If ${esc(childLabel)}'s scores have not moved, or you simply decide it is not right for your family, email ${esc(CONTACT_SUPPORT)} and we refund the full amount &mdash; no form, no interrogation, no asking you to stay. The full policy is in the <a href="${esc(link('/terms'))}" style="color:${MUTED};">refunds section of our terms</a>.
</div>
`, SUCCESS)
}

/** Countdown block. Red, because this is the one that should create urgency. */
function deadlineCallout(
  expiresAt: string,
  offerName: string,
  originalLabel: string
): string {
  const days = daysRemaining(expiresAt)
  return callout(`
<div style="font-size:14px;font-weight:700;color:${DANGER};margin-bottom:4px;">
This price closes ${esc(formatDeadline(expiresAt))}
</div>
<div style="font-size:13px;color:${MUTED};">
${days === 0 ? 'Today is the last day.' : `${days} ${days === 1 ? 'day' : 'days'} left.`} After that the ${esc(offerName)} returns to ${esc(originalLabel)}. We run the launch price once per family, and the countdown does not reset if you close the tab.
</div>
`, DANGER)
}

/** Support address, sourced from site-config so it cannot drift from /contact. */
const CONTACT_SUPPORT = CONTACT.supportEmail


/** Build the step-7 offer email. See the block comment above for the reasoning. */
export function offerEmail(input: OfferEmailInput): EmailMessage {
  const discountPercent =
    input.originalAmountCents > input.offerAmountCents
      ? Math.round((1 - input.offerAmountCents / input.originalAmountCents) * 100)
      : 0

  const days = daysRemaining(input.expiresAt)
  const priceLabel = money(input.offerAmountCents, input.currency)
  const originalLabel = money(input.originalAmountCents, input.currency)
  const preheader = `${priceLabel} one-time (normally ${originalLabel}), ${input.guaranteeDays}-day money-back guarantee. Closes ${formatDeadline(input.expiresAt)}.`

  const anchorLine =
    discountPercent > 0
      ? `<span style="font-size:16px;font-weight:600;color:${MUTED};text-decoration:line-through;margin-left:8px;">${esc(originalLabel)}</span>` +
        `<span style="font-size:13px;font-weight:800;color:${SUCCESS};margin-left:8px;">save ${discountPercent}%</span>`
      : ''

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
${esc(input.childLabel)} has sat two full papers, so you are past the point of wondering whether this works. The question now is whether the diagnosis turns into a plan.
</p>

${
  input.primaryGap
    ? `<p style="margin:0 0 16px;">
Your readiness report put <strong>${esc(input.primaryGap)}</strong> at the top of the gap list for ${esc(input.primaryExam)}. That is a specific, fixable problem &mdash; and it is the one the ${esc(input.offerName)} is built to attack.
</p>`
    : ''
}

${callout(`
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">One-time launch offer</div>
<div style="font-size:19px;font-weight:800;color:${INK};line-height:1.3;margin-bottom:10px;">${esc(input.offerName)}</div>
<div style="font-size:32px;font-weight:800;color:${BRAND};letter-spacing:-0.02em;line-height:1.1;">
${esc(priceLabel)}${anchorLine}
</div>
<div style="font-size:13px;color:${MUTED};margin-top:8px;">One payment. No subscription, no auto-renewal.</div>
`, BRAND)}

${h2('What is included')}
${includesTable(input.includes)}

${guaranteeCallout(input.guaranteeDays, input.childLabel)}

${deadlineCallout(input.expiresAt, input.offerName, originalLabel)}

${ctaButton(input.checkoutUrl, `Get the ${input.offerName} for ${priceLabel}`)}

<p style="margin:0;text-align:center;font-size:13px;color:${MUTED};">
Secure checkout by Stripe &middot; Card, Apple Pay, Google Pay and Afterpay accepted
</p>
`

  return {
    subject:
      discountPercent > 0
        ? `${priceLabel} for the ${input.offerName} (save ${discountPercent}%) - ${days} ${days === 1 ? 'day' : 'days'} left`
        : `${input.offerName}: ${priceLabel} one-time, ${input.guaranteeDays}-day guarantee`,
    preheader,
    html: emailLayout({
      preheader,
      body,
      userId: input.userId,
      footerNote:
        'You are seeing a one-time launch price because your family completed two full assessments. It is offered once.',
    }),
    text: [
      `${input.childLabel} has sat two full papers, so you are past the point of wondering whether this works.`,
      '',
      input.primaryGap
        ? `Your readiness report put ${input.primaryGap} at the top of the gap list for ${input.primaryExam}.`
        : '',
      '',
      input.offerName,
      `  ${priceLabel} one-time${discountPercent > 0 ? ` (normally ${originalLabel} - save ${discountPercent}%)` : ''}`,
      '  No subscription, no auto-renewal.',
      '',
      'WHAT IS INCLUDED:',
      ...input.includes.map((item) => `  - ${item}`),
      '',
      `${input.guaranteeDays}-DAY MONEY-BACK GUARANTEE`,
      `Use it properly for ${input.guaranteeDays} days. If ${input.childLabel}'s scores have not moved,`,
      `or you decide it is not right, email ${CONTACT_SUPPORT} and we refund the full amount.`,
      '',
      `This price closes ${formatDeadline(input.expiresAt)}.`,
      '',
      'Secure checkout by Stripe:',
      input.checkoutUrl,
    ]
      .filter(Boolean)
      .join('\n'),
    template: 'offer',
    // Keyed on the offer expiry so a genuinely re-granted offer can email
    // again, but a retried job for the same grant cannot.
    dedupeKey: `expires:${input.expiresAt.slice(0, 10)}`,
  }
}


// =============================================================================
// STEP 8 - ONBOARD (weekly study plan + exam countdown)
// =============================================================================
export interface StudyPlanEmailInput {
  userId: string
  childLabel: string
  targetExam: string
  examDate: string | null
  daysToExam: number | null
  sessionsPerWeek: number
  /** The week's sessions, e.g. ["Tue - Fractions drill (20 min)"]. */
  weekPlan: string[]
  planUrl: string
}

/**
 * Post-purchase onboarding.
 *
 * The first seven days after payment decide whether this family renews, and the
 * strongest predictor of renewal is sessions completed - not a satisfaction
 * score. So this email's job is not to celebrate the purchase, it is to get the
 * first three sessions booked while intent is at its highest.
 *
 * The exam countdown is the mechanism. An abstract "practise regularly" is
 * ignored; "74 days to the Selective paper" converts a purchase into a schedule
 * because it makes the remaining time finite and countable.
 */
export function studyPlanEmail(input: StudyPlanEmailInput): EmailMessage {
  const sessionsLeft =
    input.daysToExam !== null
      ? Math.max(1, Math.round((input.daysToExam / 7) * input.sessionsPerWeek))
      : null

  const countdown =
    input.daysToExam !== null
      ? callout(`
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">Countdown to ${esc(input.targetExam)}</div>
<div style="font-size:38px;font-weight:800;color:${BRAND};line-height:1;letter-spacing:-0.03em;">${input.daysToExam} <span style="font-size:18px;color:${MUTED};font-weight:600;">days</span></div>
<div style="font-size:13px;color:${MUTED};margin-top:8px;">At ${input.sessionsPerWeek} sessions a week that is roughly ${sessionsLeft} sessions before exam day. That is the real budget you are working with.</div>
`, BRAND)
      : callout(`
<div style="font-size:14px;font-weight:700;color:${WARNING};margin-bottom:4px;">Add ${esc(input.childLabel)}'s exam date</div>
<div style="font-size:13px;color:${MUTED};">Without a target date the plan has no horizon and the countdown cannot start. It takes ten seconds and it is the single setting that makes the schedule stick.</div>
`, WARNING)

  const planRows = input.weekPlan
    .map(
      (session) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:${INK};">${esc(session)}</td></tr>`
    )
    .join('')

  const preheader =
    input.daysToExam !== null
      ? `${input.daysToExam} days to ${input.targetExam}. Here is ${input.childLabel}'s first week, mapped out.`
      : `${input.childLabel}'s first week is mapped out. Add an exam date to start the countdown.`

  const body = `
<p style="margin:0 0 16px;">Good news &mdash; ${esc(input.childLabel)}'s plan is live.</p>

${countdown}

${h2('This week')}
<p style="margin:0 0 8px;color:${MUTED};font-size:14px;">
${input.sessionsPerWeek} sessions, roughly 20&ndash;30 minutes each. Short and consistent beats long and sporadic every time &mdash; the spacing effect is one of the most replicated findings in learning science.
</p>
${listTable(planRows)}

<p style="margin:20px 0 0;color:${MUTED};font-size:13px;">
The plan re-generates from each attempt. When ${esc(input.childLabel)} finishes a session, next week shifts toward whatever the last paper exposed. You do not have to re-plan anything by hand.
</p>

${ctaButton(input.planUrl, "Open this week's plan")}
`

  return {
    subject:
      input.daysToExam !== null
        ? `${input.daysToExam} days to ${input.targetExam}: ${input.childLabel}'s week 1 plan`
        : `${input.childLabel}'s study plan is ready`,
    preheader,
    html: emailLayout({ preheader, body, userId: input.userId }),
    text: [
      `${input.childLabel}'s plan is live.`,
      '',
      input.daysToExam !== null
        ? `COUNTDOWN TO ${input.targetExam}: ${input.daysToExam} days`
        : 'Add an exam date to start the countdown.',
      '',
      `THIS WEEK (${input.sessionsPerWeek} sessions, 20-30 min each):`,
      ...input.weekPlan.map((session) => `  - ${session}`),
      '',
      'The plan re-generates from each attempt. When a session is finished,',
      'next week shifts toward whatever the last paper exposed.',
      '',
      input.planUrl,
    ].join('\n'),
    template: 'study_plan',
    // One per week, keyed on the date so a retried job cannot double-send.
    dedupeKey: `week:${new Date().toISOString().slice(0, 10)}`,
  }
}


// =============================================================================
// STEP 9 - EXPAND (sibling offer, next exam pack, writing booster)
// =============================================================================
export interface ExpandEmailInput {
  userId: string
  childLabel: string
  kind: 'SIBLING' | 'NEXT_PACK' | 'WRITING_BOOSTER'
  productName: string
  offerAmountCents: number
  originalAmountCents: number
  currency: string
  guaranteeDays: number
  includes: string[]
  checkoutUrl: string
  /** Only used for the sibling variant. */
  siblingNote?: string
}

/**
 * Expansion offers.
 *
 * Sent only to paying customers, and only after they have actually used the
 * first purchase. Timing matters more than copy here: an upsell fired the moment
 * a card clears reads as a cash grab and depresses the renewal, which is worth
 * far more than the second product.
 *
 * The sibling variant leans on consistency rather than on value. The parent has
 * already decided this approach works for one child, and treating their children
 * differently is uncomfortable - a stronger lever than a discount, which is why
 * the sibling price is framed as "the same, for the second child" rather than as
 * a promotion.
 */
export function expandEmail(input: ExpandEmailInput): EmailMessage {
  const priceLabel = money(input.offerAmountCents, input.currency)
  const originalLabel = money(input.originalAmountCents, input.currency)
  const hasDiscount = input.originalAmountCents > input.offerAmountCents

  const headlines: Record<
    ExpandEmailInput['kind'],
    { subject: string; opener: string; preheader: string }
  > = {
    SIBLING: {
      subject: `${input.productName} - the same plan for your other child`,
      opener: `You have seen what the plan does for ${esc(input.childLabel)}. If there is another child in the house sitting exams this year, the same diagnosis and the same schedule is available for them.`,
      preheader: `${priceLabel} for a second child profile, with its own readiness report and study plan.`,
    },
    NEXT_PACK: {
      subject: `${input.childLabel}'s next paper is ready`,
      opener: `${esc(input.childLabel)} has worked through the current pack. The next one moves up a difficulty band and re-tests the topics your readiness report flagged, so you can see whether the gaps actually closed.`,
      preheader: `${priceLabel} - re-tests the topics your readiness report flagged.`,
    },
    WRITING_BOOSTER: {
      subject: `Writing is where ${input.childLabel} loses the most marks`,
      opener: `Across every attempt on your account, the writing section is where marks are hardest to recover. The booster adds AI-marked writing tasks with criterion-level feedback against the same rubric the real assessments use.`,
      preheader: `${priceLabel} for AI-marked writing tasks against the official rubric.`,
    },
  }

  const copy = headlines[input.kind]

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>
<p style="margin:0 0 16px;">${copy.opener}</p>

${input.siblingNote ? `<p style="margin:0 0 16px;color:${MUTED};font-size:14px;">${esc(input.siblingNote)}</p>` : ''}

${callout(`
<div style="font-size:19px;font-weight:800;color:${INK};line-height:1.3;margin-bottom:10px;">${esc(input.productName)}</div>
<div style="font-size:28px;font-weight:800;color:${BRAND};letter-spacing:-0.02em;line-height:1.1;">
${esc(priceLabel)}${
    hasDiscount
      ? `<span style="font-size:15px;font-weight:600;color:${MUTED};text-decoration:line-through;margin-left:8px;">${esc(originalLabel)}</span>`
      : ''
  }
</div>
`, BRAND)}

${h2('What is included')}
${includesTable(input.includes)}

${guaranteeCallout(input.guaranteeDays, input.childLabel)}

${ctaButton(input.checkoutUrl, `Add the ${input.productName}`)}
`

  return {
    subject: copy.subject,
    preheader: copy.preheader,
    html: emailLayout({
      preheader: copy.preheader,
      body,
      userId: input.userId,
      footerNote:
        'We only send expansion offers to families who have already used what they bought.',
    }),
    text: [
      copy.opener.replace(/<[^>]+>/g, ''),
      '',
      input.productName,
      `  ${priceLabel}${hasDiscount ? ` (normally ${originalLabel})` : ''}`,
      '',
      'WHAT IS INCLUDED:',
      ...input.includes.map((item) => `  - ${item}`),
      '',
      `${input.guaranteeDays}-day money-back guarantee.`,
      '',
      input.checkoutUrl,
    ].join('\n'),
    template: 'expand',
    // One expansion email per product kind - a parent should never receive the
    // sibling pitch twice.
    dedupeKey: `kind:${input.kind}`,
  }
}


// =============================================================================
// STEP 10 - RENEW (14-day reminder, pause option, year-in-review)
// =============================================================================
export interface RenewalEmailInput {
  userId: string
  childLabel: string
  planName: string
  renewsOn: string
  daysUntilRenewal: number
  amountCents: number
  currency: string
  portalUrl: string
  pauseUrl: string
  /** Concrete evidence of value delivered over the year. */
  stats: { label: string; value: string }[]
}

/**
 * The renewal reminder, sent 14 days before the charge.
 *
 * Two decisions here are counter-intuitive but deliberate:
 *
 * 1. THE PAUSE OPTION IS PROMINENT, NOT BURIED. Offering an easy exit increases
 *    retention. A parent who can pause does not cancel, and a paused
 *    subscription resumes; a cancelled one almost never does. Hiding the pause
 *    link to protect the renewal rate produces the opposite result, because the
 *    parent who wanted to pause takes the only exit they were given.
 *
 * 2. THE EVIDENCE COMES BEFORE THE PRICE. Renewal is a re-justification, not a
 *    re-sale. The parent already decided once; what they need now is the record
 *    of what the year produced. `stats` must be real figures from their own
 *    account, because a renewal email that cannot cite evidence gets treated as
 *    a bill, and bills get resented.
 *
 * Announcing the charge before it happens is also simply honest, and surprise
 * renewals are the leading cause of card disputes. A dispute costs the
 * subscription, the Stripe fee, and a mark against the account's dispute rate
 * that raises pricing for everyone else.
 */
export function renewalReminderEmail(input: RenewalEmailInput): EmailMessage {
  const priceLabel = money(input.amountCents, input.currency)
  const preheader = `Renews ${formatDeadline(input.renewsOn)}. Here is what the year produced for ${input.childLabel}, plus how to pause or change it.`

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
Your <strong>${esc(input.planName)}</strong> renews on <strong>${esc(formatDeadline(input.renewsOn))}</strong> &mdash; ${input.daysUntilRenewal} days from now, at ${esc(priceLabel)}.
</p>

<p style="margin:0 0 16px;">Before you decide, here is what the year actually produced.</p>

${h2(`${input.childLabel}'s year in numbers`)}
${listTable(input.stats.map((stat) => listRow(stat.label, stat.value, INK)).join(''))}

${callout(`
<div style="font-size:13px;color:${MUTED};line-height:1.6;">
<strong style="color:${INK};">Not the right time?</strong> You can pause the plan instead of cancelling it. A paused subscription keeps every report, every study plan and all of ${esc(input.childLabel)}'s history, and resumes when the next exam cycle starts. Exams are seasonal &mdash; plenty of families pause over summer and come back in February.
</div>
`, WARNING)}

${ctaButton(input.portalUrl, 'Manage or renew my plan')}

<p style="margin:0;text-align:center;font-size:14px;">
<a href="${esc(input.pauseUrl)}" style="color:${MUTED};text-decoration:underline;">Pause instead</a>
&nbsp;&middot;&nbsp;
<a href="${esc(link('/contact'))}" style="color:${MUTED};text-decoration:underline;">Question about the renewal? Ask us</a>
</p>
`

  return {
    subject: `Your plan renews in ${input.daysUntilRenewal} days - ${input.childLabel}'s year so far`,
    preheader,
    html: emailLayout({
      preheader,
      body,
      userId: input.userId,
      footerNote:
        'We will not charge you before the date above, and you can pause or cancel up to that point.',
    }),
    text: [
      `Your ${input.planName} renews on ${formatDeadline(input.renewsOn)} - ${input.daysUntilRenewal} days from now, at ${priceLabel}.`,
      '',
      `${input.childLabel.toUpperCase()}'S YEAR IN NUMBERS:`,
      ...input.stats.map((stat) => `  - ${stat.label}: ${stat.value}`),
      '',
      'NOT THE RIGHT TIME?',
      'You can pause instead of cancelling. A paused subscription keeps every',
      'report, every study plan and all history, and resumes next exam cycle.',
      '',
      'Manage or renew:',
      input.portalUrl,
      '',
      'Pause instead:',
      input.pauseUrl,
    ].join('\n'),
    template: 'renewal_reminder',
    // Keyed on the period end so each billing cycle gets exactly one reminder.
    dedupeKey: `period:${input.renewsOn.slice(0, 10)}`,
  }
}


/**
 * The year-in-review email (step 10).
 *
 * Sent just before the renewal reminder. Its job is to convert a year of
 * scattered sessions into a single narrative of progress, because progress that
 * is never summarised is progress the parent does not remember - and a parent
 * who cannot recall the value does not renew.
 *
 * The "before vs after" framing is the whole point. Peak-end rule: an experience
 * is judged by its peak and its ending, not its average. This email *is* the
 * ending, so it should show the peak.
 */
export interface YearInReviewInput {
  userId: string
  childLabel: string
  year: number
  stats: { label: string; value: string }[]
  highlight: string
  nextYearFocus: string
  reviewUrl: string
}

export function yearInReviewEmail(input: YearInReviewInput): EmailMessage {
  const preheader = `${input.childLabel}'s ${input.year}: ${input.highlight}`

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
${input.year} is wrapped up. Here is what ${esc(input.childLabel)} did with it.
</p>

${callout(`
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">The headline</div>
<div style="font-size:20px;font-weight:800;color:${INK};line-height:1.35;">${esc(input.highlight)}</div>
`, BRAND)}

${h2(`${input.year} in numbers`)}
${listTable(input.stats.map((s) => listRow(s.label, s.value, INK)).join(''))}

${h2('Where to point next year')}
<p style="margin:0 0 16px;">${esc(input.nextYearFocus)}</p>

<p style="margin:20px 0 0;color:${MUTED};font-size:13px;">
Nothing is being asked of you here. Next year's plan is already generated &mdash; this is just the record of the year that finished.
</p>

${ctaButton(input.reviewUrl, 'See the full year in review')}
`

  return {
    subject: `${input.childLabel}'s ${input.year} in review`,
    preheader,
    html: emailLayout({ preheader, body, userId: input.userId }),
    text: [
      `${input.year} is wrapped up. Here is what ${input.childLabel} did with it.`,
      '',
      `THE HEADLINE: ${input.highlight}`,
      '',
      `${input.year} IN NUMBERS:`,
      ...input.stats.map((s) => `  - ${s.label}: ${s.value}`),
      '',
      'WHERE TO POINT NEXT YEAR:',
      input.nextYearFocus,
      '',
      input.reviewUrl,
    ].join('\n'),
    template: 'year_in_review',
    // Exactly one per child per year.
    dedupeKey: `${input.year}:${input.childLabel}`,
  }
}


// =============================================================================
// STEP 1/3 - REFERRAL WELCOME + DIAGNOSTIC NUDGE
// =============================================================================
export interface ReferralWelcomeInput {
  userId: string
  referrerLabel: string
  /** What the referee gets for arriving via a code. */
  refereeBenefit: string
  /** What the referrer earns once this family converts. */
  referrerBenefit: string
  startUrl: string
}

/**
 * Sent to a parent who arrived through another parent's code.
 *
 * It names the referrer. That single detail does more than any incentive: it
 * turns an anonymous marketing email into a recommendation from someone the
 * parent knows, which is the highest-trust frame available. It also creates mild
 * social accountability - the referrer will hear whether it was worth it.
 *
 * The incentive is stated plainly in both directions. Hiding the referrer's
 * reward and having it discovered later feels like a trick; stating it upfront
 * makes the sharing transaction honest and, counter-intuitively, more likely.
 */
export function referralWelcomeEmail(input: ReferralWelcomeInput): EmailMessage {
  const subject = input.referrerLabel
    ? `${input.referrerLabel} thought this would help your family`
    : 'Your free diagnostic is ready'
  const preheader = `${input.refereeBenefit} - and ${input.referrerLabel} earns ${input.referrerBenefit} if you stay.`

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
<strong>${esc(input.referrerLabel)}</strong> sent you here. They are using ${esc(SITE_NAME)} with their own child and thought it would be worth a look for yours.
</p>

${callout(`
<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Because you arrived via a referral</div>
<div style="font-size:15px;font-weight:700;color:${INK};line-height:1.5;">${esc(input.refereeBenefit)}</div>
<div style="font-size:13px;color:${MUTED};margin-top:8px;">And if you end up staying, ${esc(input.referrerLabel)} earns ${esc(input.referrerBenefit)}. Neither of you has to claim anything &mdash; it is already attached to your account.</div>
`, SUCCESS)}

<p style="margin:0 0 16px;">
The fastest way to judge whether it is useful is the free benchmark diagnostic. About 20 minutes, no card, and it produces a readiness report naming the topics where marks are actually being lost.
</p>

${ctaButton(input.startUrl, 'Start the free diagnostic')}
`

  return {
    subject,
    preheader,
    html: emailLayout({ preheader, body, userId: input.userId }),
    text: [
      `${input.referrerLabel} sent you here. They are using ${SITE_NAME} with their own child.`,
      '',
      `BECAUSE YOU ARRIVED VIA A REFERRAL: ${input.refereeBenefit}`,
      `And if you stay, ${input.referrerLabel} earns ${input.referrerBenefit}.`,
      '',
      'The fastest way to judge whether it is useful is the free benchmark',
      'diagnostic. About 20 minutes, no card, and it produces a readiness report',
      'naming the topics where marks are actually being lost.',
      '',
      input.startUrl,
    ].join('\n'),
    template: 'referral_welcome',
    dedupeKey: 'welcome',
  }
}


export interface DiagnosticNudgeInput {
  userId: string
  childLabel: string
  hoursRemaining: number
  testTitle: string
  timeLimitMins: number
  startUrl: string
}

/**
 * The step-3 nudge: the diagnostic was assigned but not finished.
 *
 * The spec gives the student 24 hours. This email is what makes that deadline
 * real rather than decorative - a window nobody reminds you about is not a
 * window, it is a date in a database.
 *
 * Sent once, partway through. Twice it becomes nagging; never, and the 24-hour
 * mechanic accomplishes nothing. The closing line promises no follow-up, which
 * is both true (the dedupe key enforces it) and the reason the email does not
 * read as pressure.
 */
export function diagnosticNudgeEmail(input: DiagnosticNudgeInput): EmailMessage {
  const preheader = `${input.testTitle} is still waiting for ${input.childLabel}. ${input.hoursRemaining} hours left in the free window.`

  const body = `
<p style="margin:0 0 16px;">Hi there,</p>

<p style="margin:0 0 16px;">
The free diagnostic for ${esc(input.childLabel)} has not been started yet. It is still on their dashboard and it is still free &mdash; but the window we hold it open for closes in <strong>${input.hoursRemaining} hours</strong>.
</p>

${callout(`
<div style="font-size:15px;font-weight:700;color:${INK};margin-bottom:4px;">${esc(input.testTitle)}</div>
<div style="font-size:13px;color:${MUTED};">About ${input.timeLimitMins} minutes &middot; no card &middot; produces a full readiness report</div>
`, BRAND)}

<p style="margin:0 0 16px;">
It is worth finding ${input.timeLimitMins} quiet minutes rather than letting it lapse. The readiness report it produces is what every later recommendation is based on &mdash; without it we can tell you ${esc(input.childLabel)} has an account, but not where the marks are going.
</p>

${ctaButton(input.startUrl, 'Start the diagnostic now')}

<p style="margin:0;color:${MUTED};font-size:13px;">
If the timing is wrong, ignore this. We will not email you about it again.
</p>
`

  return {
    subject: `${input.childLabel}'s free diagnostic closes in ${input.hoursRemaining} hours`,
    preheader,
    html: emailLayout({ preheader, body, userId: input.userId }),
    text: [
      `The free diagnostic for ${input.childLabel} has not been started yet.`,
      `It is still on their dashboard and still free - the window closes in ${input.hoursRemaining} hours.`,
      '',
      `  ${input.testTitle}`,
      `  About ${input.timeLimitMins} minutes, no card, produces a full readiness report`,
      '',
      'The readiness report is what every later recommendation is based on.',
      '',
      input.startUrl,
      '',
      'If the timing is wrong, ignore this. We will not email you about it again.',
    ].join('\n'),
    template: 'diagnostic_nudge',
    // Once per family, ever.
    dedupeKey: 'first',
  }
}

