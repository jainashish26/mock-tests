import { toEvaluationDetail, scoreBand } from '@/lib/writing/evaluation-detail'
import type { WritingCategoryScores, WritingEvaluationDetail } from '@/lib/writing/types'
import { ParentActionSummary } from './ParentActionSummary'
import { LockedInsightCard } from './LockedInsightPanel'
import { Lock } from 'lucide-react'
import Link from 'next/link'

/**
 * Enhanced writing feedback for the parent/tutor report. Renders the full
 * DeepSeek evaluation: band, category breakdown, techniques, strengths,
 * improvements (with estimated gains + grammar rewrites), side-by-side rewrite
 * and the practice exercise. Server component - no client state.
 */

const CATEGORIES = [
  { key: 'language_mechanics', label: 'Language Mechanics', max: 20 },
  { key: 'vocabulary', label: 'Vocabulary', max: 15 },
  { key: 'cohesion_structure', label: 'Cohesion & Structure', max: 20 },
  { key: 'content_ideas', label: 'Content & Ideas', max: 25 },
  { key: 'engagement_style', label: 'Engagement & Style', max: 20 },
] as const

type CategoryKey = (typeof CATEGORIES)[number]['key']

function subCriteria(key: CategoryKey, cats: WritingCategoryScores | null): string | null {
  if (!cats) return null
  const c: Record<string, unknown> = cats[key] as unknown as Record<string, unknown>
  if (!c || typeof c !== 'object') return null
  const parts: string[] = []
  if (typeof c.grammar === 'number') parts.push(`Grammar ${c.grammar}/10, Spelling ${c.spelling}/5, Punctuation ${c.punctuation}/5`)
  if (typeof c.effective_word_choices === 'number') parts.push(`Word choice ${c.effective_word_choices}/10, Variety ${c.varied_word_usage}/5`)
  if (typeof c.cohesiveness === 'number') parts.push(`Cohesiveness ${c.cohesiveness}/10, Structure ${c.structure}/10`)
  if (typeof c.relevance === 'number') parts.push(`Relevance ${c.relevance}/10, Depth ${c.depth_originality}/10, Support ${c.evidence_support}/5`)
  if (typeof c.engagement === 'number') parts.push(`Engagement ${c.engagement}/5, Tone ${c.tone_voice}/5, Language features ${c.language_features}/10`)
  return parts.join(' · ') || null
}

function barColour(pct: number): string {
  if (pct >= 90) return 'var(--color-success)'
  if (pct >= 70) return 'var(--color-primary)'
  if (pct >= 50) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

function BandBadge({ detail }: { detail: WritingEvaluationDetail }) {
  const band = scoreBand(detail.score_out_of100)
  const tone =
    band === 'Excellent' ? 'var(--color-success)'
      : band === 'Good' ? 'var(--color-primary)'
        : band === 'Satisfactory' ? 'var(--color-warning)'
          : 'var(--color-danger)'
  return (
    <span style={{ background: tone, color: '#fff', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700 }}>
      {band}
    </span>
  )
}

export function WritingReportPanel({ evaluations, studentText, unlocked = false }: { evaluations: Record<string, unknown>[]; studentText?: string; unlocked?: boolean }) {
  if (!evaluations || evaluations.length === 0) return null

  return (
    <section style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {evaluations.map((ev, i) => {
        const detail = toEvaluationDetail(ev)
        if (!detail) return null
        return (
          <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Writing Feedback</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <BandBadge detail={detail} />
                <strong style={{ fontSize: '1.6rem', color: 'var(--color-primary)' }}>{detail.score_out_of100}/100</strong>
              </div>
            </div>

            <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem', fontSize: '0.85rem' }}>
              {[
                detail.text_type,
                detail.word_count ? `${detail.word_count} words` : null,
                detail.rubric_version ? `rubric ${detail.rubric_version}` : null,
                detail.model,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {unlocked && detail.category_scores && (
              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {CATEGORIES.map(({ key, label, max }) => {
                  const total = detail.category_scores?.[key]?.total ?? 0
                  const pct = max > 0 ? (total / max) * 100 : 0
                  return (
                    <div key={key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{detail.category_scores?.[key]?.total ?? 0}/{max}</span>
                      </div>
                      <div style={{ background: 'var(--color-border)', borderRadius: '999px', height: '0.6rem', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: barColour(pct), borderRadius: '999px' }} />
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                        {subCriteria(key, detail.category_scores)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {unlocked && detail.techniques_used.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem' }}>Techniques detected</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {detail.techniques_used.map((t, ti) => (
                    <span key={ti} style={{ background: 'var(--color-bg, #f1f5f9)', border: '1px solid var(--color-border)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detail.strengths.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', color: 'var(--color-success)' }}>Strengths</h4>
                <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                  {detail.strengths.map((s, si) => (
                    <li key={si}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {detail.improvements.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', color: 'var(--color-warning)' }}>Areas to improve</h4>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(unlocked ? detail.improvements : detail.improvements.slice(0, 2)).map((imp, ii) => (
                    <li key={ii}>
                      <div>{imp.suggestion}</div>
                      {unlocked && imp.estimated_score_gain > 0 && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 700 }}>
                          +{Math.round(imp.estimated_score_gain)} points
                        </span>
                      )}
                      {unlocked && imp.rewrite && (
                        <div style={{ marginTop: '0.4rem', fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                          Revision: {imp.rewrite}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {unlocked && detail.improved_text && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem' }}>High Distinction rewrite</h4>
                <div style={{ display: 'grid', gridTemplateColumns: studentText ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                  {studentText && (
                    <div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>Your child&apos;s text</div>
                      <div style={{ whiteSpace: 'pre-wrap', background: 'var(--color-bg, #f8fafc)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                        {studentText}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>Polished version</div>
                    <div style={{ whiteSpace: 'pre-wrap', background: 'var(--color-bg, #f8fafc)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                      {detail.improved_text}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {unlocked && detail.practice_exercise && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem' }}>Targeted practice</h4>
                <div style={{ whiteSpace: 'pre-wrap', background: 'var(--color-bg, #f8fafc)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                  {detail.practice_exercise}
                </div>
              </div>
            )}

            {unlocked && <ParentActionSummary detail={detail} />}

            {!unlocked && (
              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <LockedInsightCard
                  title="Full writing feedback"
                  body="Category breakdown, techniques used, the high-distinction rewrite of your child's text, and a targeted practice exercise."
                  icon={<Lock size={16} aria-hidden="true" />}
                />
                <Link href="/pricing" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                  Unlock the full writing report →
                </Link>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}