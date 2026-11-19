'use client'

import { useId, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy } from 'lucide-react'
import { SiblingOfferCard } from '@/features/monetisation/SiblingOfferCard'
import type { SiblingOfferPayload } from '@/lib/pricing/sibling-rules'
import css from './child-creation-form.module.css'

interface ChildCreationFormProps {
  apiEndpoint?: string
  maxStudents?: number | null
  currentCount?: number
}

export function ChildCreationForm({ apiEndpoint = '/api/parent/child', maxStudents = 4, currentCount = 0 }: ChildCreationFormProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ username?: string; error?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // N-5: the sibling pitch, fetched only after a second-or-later child is
  // created AND only if the server says the family is eligible. Null renders
  // nothing - a failed lookup must never disturb the creation success state.
  const [siblingOffer, setSiblingOffer] = useState<SiblingOfferPayload | null>(null)

  const id = useId()
  const yearLevelId = `${id}-year-level`
  const passwordId = `${id}-password`

  const isAtLimit = maxStudents !== null && currentCount >= maxStudents

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    setCopied(false)
    setSiblingOffer(null)

    const form = e.currentTarget
    const formData = new FormData(form)
    const yearLevel = formData.get('yearLevel')
    const password = formData.get('password')

    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearLevel, password })
      })
      const data = await res.json()

      if (data.error) throw new Error(data.error)
      setResult({ username: data.username })
      form.reset()

      // N-5: surface the sibling offer at the moment a second child is added.
      // The parent API returns childCount; the tutor API does not, so this
      // branch simply never runs in the tutor flow. Eligibility is decided
      // server-side (CUSTOMER stage, >=2 children, redemption limit).
      if (typeof data.childCount === 'number' && data.childCount >= 2) {
        try {
          const offerRes = await fetch('/api/parent/sibling-offer')
          const offerData = await offerRes.json()
          if (offerData?.eligible && offerData.offer) {
            setSiblingOffer(offerData.offer as SiblingOfferPayload)
          }
        } catch {
          // The pitch is an enhancement; the creation already succeeded.
        }
      }
    } catch (err) {
      setResult({
        error:
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }

  const copyUsername = async () => {
    if (!result?.username) return
    try {
      await navigator.clipboard.writeText(result.username)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (older browsers / insecure context) — username
      // stays visible in the banner for manual copying.
    }
  }

  return (
    <div>
      {isAtLimit && (
        <div className={`${css.banner} ${css.bannerWarn}`} role="alert">
          <AlertTriangle size={16} className={css.bannerIcon} aria-hidden="true" />
          <span>
            You&rsquo;ve reached the maximum of <strong>{maxStudents}</strong> student
            profiles. To add more, please upgrade your plan or contact support.
          </span>
        </div>
      )}

      {result?.error && (
        <div className={`${css.banner} ${css.bannerError}`} role="alert">
          <AlertTriangle size={16} className={css.bannerIcon} aria-hidden="true" />
          <span>{result.error}</span>
        </div>
      )}

      {result?.username && (
        <div className={`${css.banner} ${css.bannerSuccess}`} role="status">
          <CheckCircle2 size={16} className={css.bannerIcon} aria-hidden="true" />
          <div>
            <strong>Profile created!</strong> Your child&rsquo;s username is{' '}
            <code className={css.usernameChip}>{result.username}</code>
            <button type="button" onClick={copyUsername} className={css.copyBtn}>
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <div className={css.successHint}>
              They can log in using this username and the password you set.
            </div>
          </div>
        </div>
      )}

      {siblingOffer && <SiblingOfferCard offer={siblingOffer} surface="add-child" />}

      <form onSubmit={handleSubmit} className={css.form}>
        <div className={css.field}>
          <label htmlFor={yearLevelId} className={css.label}>
            Year Level <span className={css.labelHint}>(2–9)</span>
          </label>
          <select
            id={yearLevelId}
            name="yearLevel"
            required
            disabled={isAtLimit}
            className={`${css.control} ${css.select}`}
          >
            <option value="">Select Year</option>
            {[2, 3, 4, 5, 6, 7, 8, 9].map((y) => (
              <option key={y} value={y}>Year {y}</option>
            ))}
          </select>
        </div>

        <div className={css.field}>
          <label htmlFor={passwordId} className={css.label}>
            Student Password <span className={css.labelHint}>(min 6 characters)</span>
          </label>
          <input
            id={passwordId}
            type="password"
            name="password"
            required
            minLength={6}
            disabled={isAtLimit}
            className={css.control}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>

        <button type="submit" disabled={loading || isAtLimit} className={css.submit}>
          {loading ? 'Creating…' : isAtLimit ? 'Profile limit reached' : 'Create Profile'}
        </button>
      </form>
    </div>
  )
}
