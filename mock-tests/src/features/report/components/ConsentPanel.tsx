'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TutorConsentRow } from '@/lib/reporting/types'

/**
 * P10 - Consent & Access Control, on the parent's child page.
 *
 * Answers PA9: "Who can see my child's data?" - and lets them change the answer.
 * This is the control that makes the whole tutor surface lawful; without it,
 * consent would be rows only an administrator could insert.
 *
 * A client component because granting and revoking are actions. The list comes
 * from the API, gated in SQL on is_parent_of() AND may_read_results() - a student
 * cannot grant away access to their own data.
 *
 * Revocation is immediate and is stated as such: is_tutor_of() evaluates consent
 * at query time, so the tutor loses access on their next request. The record is
 * kept, not deleted, because it is the audit trail.
 */

const STATE_STYLE: Record<TutorConsentRow['state'], string> = {
  ACTIVE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  REVOKED: 'border-border bg-muted text-muted-foreground',
  EXPIRED: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  NO_CONSENT: 'border-border bg-muted text-muted-foreground',
}

const STATE_LABEL: Record<TutorConsentRow['state'], string> = {
  ACTIVE: 'Has access',
  REVOKED: 'Access withdrawn',
  EXPIRED: 'Access expired',
  NO_CONSENT: 'Never granted',
}

export function ConsentPanel({ studentId, childLabel }: { studentId: string; childLabel: string }) {
  const [rows, setRows] = useState<TutorConsentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [months, setMonths] = useState(12)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reporting/parent/consents?studentId=${encodeURIComponent(studentId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not load access list')
      setRows(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load access list')
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load])
  async function grant(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/reporting/parent/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, tutorEmail: email, months }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not grant access')
      setEmail('')
      setNotice(`Access granted for ${months} month${months === 1 ? '' : 's'}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant access')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(tutorUserId: string, tutorEmail: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(
        `/api/reporting/parent/consents?studentId=${encodeURIComponent(studentId)}&tutorUserId=${encodeURIComponent(tutorUserId)}`,
        { method: 'DELETE' }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not withdraw access')
      setNotice(`Access withdrawn for ${tutorEmail}. It stops immediately.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw access')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="panel-P10"
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3">
        <h2 id="panel-P10" className="text-sm font-semibold tracking-tight">
          Who can see {childLabel}&apos;s data
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          P10 · tutors only see this child while you allow it · withdrawing access takes effect
          immediately
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tutor has access to {childLabel}&apos;s data. Nobody outside your account can see it.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.tutor_user_id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2 text-xs last:border-0"
            >
              <div className="min-w-0">
                <p className="font-medium">{r.tutor_email}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {r.is_current && r.expires_at
                    ? `Access until ${new Date(r.expires_at).toLocaleDateString()}`
                    : r.revoked_at
                      ? `Withdrawn ${new Date(r.revoked_at).toLocaleDateString()}`
                      : 'No current access'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[0.625rem] font-bold uppercase ${STATE_STYLE[r.state]}`}>
                  {STATE_LABEL[r.state]}
                </span>
                {r.is_current && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(r.tutor_user_id, r.tutor_email)}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-[0.6875rem] font-medium text-destructive disabled:opacity-50"
                  >
                    Withdraw access
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={grant} className="mt-4 border-t border-border pt-3">
        <p className="mb-2 text-xs font-medium">Give a tutor access</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs">
            <span className="mb-1 block text-muted-foreground">Tutor&apos;s email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tutor@example.com"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">For</span>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              {[3, 6, 12, 18, 24].map((m) => (
                <option key={m} value={m}>{m} months</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || !email}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Grant access
          </button>
        </div>
        {/* Access is never indefinite: every grant has an end date. */}
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">
          Access always expires. You can withdraw it at any time, and the tutor loses it immediately.
        </p>
      </form>
    </section>
  )
}
