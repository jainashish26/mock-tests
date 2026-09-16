'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function QuestionEditor({ initialData, isNew }: { initialData?: any, isNew?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSkills, setShowSkills] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    
    // Parse complex fields
    const payload: any = {}
    
    // String fields
    const textFields = [
      'type', 'exam_id', 'exam_type', 'exam_section', 'subject', 'topic', 'sub_topic',
      'stem', 'comprehension_text', 'image_url', 'answer_a', 'answer_b', 'answer_c', 
      'answer_d', 'answer_e', 'correct_answer', 'explanation', 'explanation_media', 'status'
    ]
    textFields.forEach(f => {
      const val = formData.get(f)
      if (val) payload[f] = val
    })

    // Int fields
    const intFields = ['year_level', 'difficulty', 'average_time_seconds', 'correct_answer_score']
    intFields.forEach(f => {
      const val = formData.get(f)
      if (val !== null && val !== '') payload[f] = parseInt(val as string)
    })

    // Float fields
    const floatFields = [
      'discrimination_index',
      'skill_grammar', 'skill_spelling', 'skill_vocabulary', 'skill_reading',
      'skill_writing', 'skill_algebra', 'skill_word_problems', 'skill_geometry',
      'skill_statistics', 'skill_mental_maths', 'skill_problem_solving',
      'skill_numerical_reasoning', 'skill_verbal_reasoning', 'skill_logical_reasoning',
      'skill_critical_thinking'
    ]
    floatFields.forEach(f => {
      const val = formData.get(f)
      if (val !== null && val !== '') payload[f] = parseFloat(val as string)
    })

    try {
      const url = isNew ? `/api/creator/questions` : `/api/creator/questions/${initialData.id}`
      const method = isNew ? 'POST' : 'PUT'
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to save')
      }
      
      router.push('/creator')
      router.refresh()
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2rem', background: 'var(--color-surface)', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
      {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
      
      {/* SECTION 1: CORE CONTENT */}
      <div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border)' }}>1. Core Content</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Question Type *</div>
              <select name="type" defaultValue={initialData?.type || 'MCQ'} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                <option value="MCQ">Multiple Choice</option>
                <option value="SHORT_ANSWER">Short Answer</option>
                <option value="WRITING">Writing</option>
                <option value="READING_COMPREHENSION">Reading Comprehension</option>
              </select>
            </label>
            <label>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Status *</div>
              <select name="status" defaultValue={initialData?.status || 'DRAFT'} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                <option value="DRAFT">Draft</option>
                <option value="PENDING_APPROVAL">Pending Approval</option>
              </select>
            </label>
          </div>

          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Comprehension Text / Passage</div>
            <textarea name="comprehension_text" defaultValue={initialData?.comprehension_text || ''} rows={4} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} placeholder="Passage or stimulus text..." />
          </label>

          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Question Text (Stem) *</div>
            <textarea name="stem" defaultValue={initialData?.stem || ''} required rows={3} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Question Media URL (JPG/PNG)</div>
            <input type="text" name="image_url" defaultValue={initialData?.image_url || ''} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
        </div>
      </div>

      {/* SECTION 2: ANSWERS */}
      <div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border)' }}>2. Answer Key</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {['a', 'b', 'c', 'd', 'e'].map(ltr => (
            <label key={ltr}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Answer {ltr.toUpperCase()} {ltr === 'a' || ltr === 'b' ? '*' : ''}</div>
              <input type="text" name={`answer_${ltr}`} defaultValue={initialData?.[`answer_${ltr}`] || ''} required={ltr === 'a' || ltr === 'b'} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
            </label>
          ))}
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--color-primary)' }}>Correct Answer Key *</div>
            <input type="text" name="correct_answer" defaultValue={initialData?.correct_answer || ''} required placeholder="e.g. A, B, or free-text" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-primary)', borderRadius: '4px', background: 'rgba(79, 70, 229, 0.05)' }} />
          </label>
        </div>
      </div>

      {/* SECTION 3: CLASSIFICATION */}
      <div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border)' }}>3. Classification & Structure</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Exam ID Link</div>
            <input type="text" name="exam_id" defaultValue={initialData?.exam_id || ''} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} placeholder="e.g. uuid" />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Exam Type *</div>
            <select name="exam_type" defaultValue={initialData?.exam_type || 'NAPLAN_STYLE_READING'} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
              <option value="BENCHMARK">Benchmark</option>
              <option value="NAPLAN_STYLE_READING">NAPLAN Style Reading</option>
              <option value="NAPLAN_STYLE_NUMERACY">NAPLAN Style Numeracy</option>
              <option value="NAPLAN_STYLE_LANGUAGE_CONVENTION">NAPLAN Style Language Convention</option>
              <option value="MATHS_OLYMPIAD">Maths Olympiad</option>
              <option value="ENGLISH_OLYMPIAD">English Olympiad</option>
              <option value="SELECTIVE">Selective Entry</option>
              <option value="GRAMMAR">Grammar</option>
              <option value="VERBAL_REASONING">Verbal Reasoning</option>
              <option value="NUMERICAL_REASONING">Numerical Reasoning</option>
              <option value="SPELLING">Spelling</option>
              <option value="MENTAL_MATHS">Mental Maths</option>
              <option value="GEOMETRY">Geometry</option>
              <option value="WORD_PROBLEMS">Word Problems</option>
              <option value="PROBLEM_SOLVING">Problem Solving</option>
              <option value="CRITICAL_THINKING">Critical Thinking</option>
              <option value="VOCABULARY">Vocabulary</option>
            </select>
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Exam Section *</div>
            <input type="text" name="exam_section" defaultValue={initialData?.exam_section || ''} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Year Level (2-8) *</div>
            <input type="number" name="year_level" min="2" max="8" defaultValue={initialData?.year_level || ''} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Subject *</div>
            <input type="text" name="subject" defaultValue={initialData?.subject || ''} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Topic</div>
            <input type="text" name="topic" defaultValue={initialData?.topic || ''} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Sub-Topic</div>
            <input type="text" name="sub_topic" defaultValue={initialData?.sub_topic || ''} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
        </div>
      </div>

      {/* SECTION 4: DIAGNOSTICS */}
      <div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border)' }}>4. Diagnostics & Explanations</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Difficulty (1-5) *</div>
            <input type="number" name="difficulty" min="1" max="5" defaultValue={initialData?.difficulty || 2} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Correct Answer Score *</div>
            <input type="number" name="correct_answer_score" defaultValue={initialData?.correct_answer_score || 1} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Discrimination Index (0-1)</div>
            <input type="number" step="0.01" name="discrimination_index" defaultValue={initialData?.discrimination_index || ''} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Average Time (Seconds)</div>
            <input type="number" name="average_time_seconds" defaultValue={initialData?.average_time_seconds || ''} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Explanation Text</div>
            <textarea name="explanation" defaultValue={initialData?.explanation || ''} rows={3} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
          <label>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Explanation Media URL</div>
            <input type="text" name="explanation_media" defaultValue={initialData?.explanation_media || ''} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
          </label>
        </div>
      </div>

      {/* SECTION 5: SKILLS */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>5. Skill Weightings (0-1)</h3>
          <button type="button" onClick={() => setShowSkills(!showSkills)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>
            {showSkills ? 'Hide Fields ▲' : 'Show Fields ▼'}
          </button>
        </div>
        {showSkills && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            {['grammar', 'spelling', 'vocabulary', 'reading', 'writing', 'algebra', 'word_problems', 'geometry', 'statistics', 'mental_maths', 'problem_solving', 'numerical_reasoning', 'verbal_reasoning', 'logical_reasoning', 'critical_thinking'].map(skill => (
              <label key={skill}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem', textTransform: 'capitalize' }}>{skill.replace('_', ' ')}</div>
                <input type="number" step="0.1" max="1" min="0" name={`skill_${skill}`} defaultValue={initialData?.[`skill_${skill}`] || 0} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '1rem', padding: '1.5rem', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" disabled={loading} style={{ padding: '0.75rem 2rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 700, fontSize: '1.125rem' }}>
          {loading ? 'Saving...' : (isNew ? 'Create Question' : 'Save Changes')}
        </button>
      </div>
    </form>
  )
}
