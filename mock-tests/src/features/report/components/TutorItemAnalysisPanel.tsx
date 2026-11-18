'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ItemStatisticsRow } from '@/lib/reporting/types'
import {
  defectReasonLabel,
  formatPValue,
  itemStatisticsHeadline,
  topDistractor,
} from '@/lib/reporting/format'

/**
 * T4 - Item Analysis for a test the tutor assigned.
 *
 * A CLIENT COMPONENT BECAUSE THE TEST IS A CHOICE, NOT A DEFAULT. §12 specifies
 * `/api/reporting/tutor/item-analysis?testId=` with a 403 unless the tutor assigned
 * that test, so there is no "all tests" view to fall back to. The selector is
 * populated from the tutor's own assignments; picking one is the only way in.
 *
 * THE SAME NUMBERS AN ADMIN SEES. Both this and A1 read
 * reporting.item_statistics(), so difficulty, discrimination and the distractor
 * breakdown have one definition (§5 X-6). The population differs - here it is the
 * tutor's consented students who were set this test - and that is the point: a
 * tutor asking "is this item working for MY students?" must not be shown the whole
 * platform's answer.
 *
 * §12 ACCESSIBILITY RULE, HONOURING IT LITERALLY
 *   "Flagged items marked with an icon AND a text label." An icon alone is
 *   invisible to a screen reader and ambiguous to anyone who does not share the
 *   designer's colour assumptions, so every flag carries its wording too. The
 *   wording names the observation ("a wrong option was chosen more often than the
 *   key"), never a verdict to delete the item - §4.6 assigns retire/rewrite/
 *   recalibrate to a human who can read the stem.
 *
 * THE CAVEATS COME FROM THE SERVER, NOT FROM HERE. `markingCaveat` and
 * `skipCaveat` are derived in SQL from the data, so they disappear by themselves
 * when the underlying defect is fixed. Hardcoding a warning in this component
 * would outlive the fix and start lying.
 */

interface AssignedTest {
  test_id: string
  test_title: string | null
}

interface ResponseShape {
  data: {
    items: ItemStatisticsRow[]
    markingCaveat: string | null
    skipCaveat: string | null
  } | null
  error?: string
}

export function TutorItemAnalysisPanel({ tests }: { tests: AssignedTest[] }) {
  const [testId, setTestId] = useState<string>(tests[0]?.test_id ?? '')
  const [rows, setRows] = useState<ItemStatisticsRow[]>([])
  const [markingCaveat, setMarkingCaveat] = useState<string | null>(null)
  const [skipCaveat, setSkipCaveat] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/reporting/tutor/item-analysis?testId=${encodeURIComponent(id)}`
      )
      const json = (await res.json()) as ResponseShape
      if (!res.ok) {
        // 403 means the tutor did not assign this test. That is distinct from
        // "no data yet" and must not be flattened into the same message.
        if (res.status === 403) {
          throw new Error(
            'You did not assign this test, so its item statistics are not available to you.'
          )
        }
        throw new Error(json?.error ?? 'Could not load item analysis')
      }
      setRows(json.data?.items ?? [])
      setMarkingCaveat(json.data?.markingCaveat ?? null)
      setSkipCaveat(json.data?.skipCaveat ?? null)
    } catch (err) {
      setRows([])
      setError(err instanceof Error ? err.message : 'Could not load item analysis')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(testId)
  }, [load, testId])

  if (tests.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Item analysis is available per test you have assigned. Assign a test first and it will
        appear here.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex-1 text-xs">
          <span className="mb-1 block text-muted-foreground">Test you assigned</span>
          <select
            value={testId}
            onChange={(e) => {
              setTestId(e.target.value)
              setExpanded(null)
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {tests.map((t) => (
              <option key={t.test_id} value={t.test_id}>
                {t.test_title ?? 'Untitled test'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      {markingCaveat && (
        <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800">
          {markingCaveat}
        </p>
      )}
      {skipCaveat && (
        <p className="mb-2 rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {skipCaveat}
        </p>
      )}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading item analysis…</p>
      ) : rows.length === 0 && !error ? (
        <p className="text-xs text-muted-foreground">
          No responses yet from your consented students on this test. Item statistics appear once
          they have answered.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{itemStatisticsHeadline(rows)}</p>
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {['Item', 'Difficulty', 'n', 'Top distractor', 'Median time', 'Skip', 'Flag'].map(
                    (h) => (
                      <th key={h} className="px-2 py-1.5 font-medium text-muted-foreground">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ItemRow
                    key={r.item_id}
                    row={r}
                    isOpen={expanded === r.item_id}
                    onToggle={() => setExpanded(expanded === r.item_id ? null : r.item_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * One item row plus its drill-down.
 *
 * §12 asks for "Item -> full distractor breakdown", so the per-option detail sits
 * behind the row rather than being crammed into the summary. Extracted as its own
 * component because a fragment inside `rows.map` cannot take a key.
 */
function ItemRow({
  row: r,
  isOpen,
  onToggle,
}: {
  row: ItemStatisticsRow
  isOpen: boolean
  onToggle: () => void
}) {
  const top = topDistractor(r)

  return (
    <>
      <tr className="border-t border-border/60 align-top hover:bg-muted/40">
        <td className="px-2 py-1.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            className="text-left font-medium underline decoration-dotted underline-offset-2"
          >
            {r.topic ?? 'Untitled'}
            {r.subject ? ` · ${r.subject}` : ''}
          </button>
          <p className="mt-0.5 text-[0.625rem] text-muted-foreground">
            {r.students} student{r.students === 1 ? '' : 's'}
            {!r.enough_evidence && ' · below minimum responses'}
          </p>
        </td>
        <td className="px-2 py-1.5 tabular-nums">{formatPValue(r.p_value)}</td>
        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.responses}</td>
        <td className="px-2 py-1.5 tabular-nums">
          {top ? `${top.option}${top.share_pct !== null ? ` · ${top.share_pct}%` : ''}` : '—'}
        </td>
        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
          {r.median_time_seconds !== null ? `${r.median_time_seconds}s` : '—'}
        </td>
        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
          {/* Unavailable, not zero: 0% would claim nobody skipped, when skips are
              simply not recorded. */}
          {r.skip_rate_reliable && r.skip_rate_pct !== null ? `${r.skip_rate_pct}%` : 'n/a'}
        </td>
        <td className="px-2 py-1.5">
          {r.is_defective ? (
            // Icon AND text, per §12. The icon alone is invisible to a screen
            // reader and meaningless without the colour convention.
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase text-amber-800">
              <span aria-hidden="true">▲</span>
              {r.defect_reasons.length} flag{r.defect_reasons.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="text-[0.625rem] uppercase text-muted-foreground">
              {r.enough_evidence ? 'No flags' : 'Too few responses'}
            </span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-border/40 bg-muted/30">
          <td colSpan={7} className="px-2 py-2">
            {r.defect_reasons.length > 0 && (
              <ul className="mb-2 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                {r.defect_reasons.map((reason) => (
                  <li key={reason}>{defectReasonLabel(reason)}</li>
                ))}
              </ul>
            )}
            <p className="mb-1 text-[0.6875rem] font-medium">
              Option breakdown{r.key_option ? ` · key is ${r.key_option}` : ''}
            </p>
            <ul className="space-y-0.5 text-[0.6875rem] tabular-nums">
              {r.distractors.map((d) => (
                <li key={d.option} className="flex justify-between gap-2">
                  <span>
                    {d.option}
                    {d.is_key ? ' (key)' : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {d.n} · {d.share_pct ?? '—'}%
                  </span>
                </li>
              ))}
              {r.distractors.length === 0 && (
                <li className="text-muted-foreground">No option data.</li>
              )}
            </ul>
            {r.dead_distractors.length > 0 && (
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Never chosen: {r.dead_distractors.join(', ')}
              </p>
            )}
            {r.point_biserial !== null && (
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Discrimination {r.point_biserial} — correlation with the rest of the test, this
                item excluded from its own rest score.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
