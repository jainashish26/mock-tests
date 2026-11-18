import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

// ── CSV column name → DB column name mapping ──
const CSV_TO_DB: Record<string, string> = {
  'questionid':           '_skip_',
  'examid':               'exam_id',
  'examtype':             'exam_type',
  'examsection':          'exam_section',
  'yearlevel':            'year_level',
  'subject':              'subject',
  'topic':                'topic',
  'subtopic':             'sub_topic',
  'questiontype':         'type',
  'comprehensiontext':    'comprehension_text',
  'questiontext':         'stem',
  'questionmedia':        'image_url',
  'correct':              'correct_answer',
  'answera':              'answer_a',
  'answerb':              'answer_b',
  'answerc':              'answer_c',
  'answerd':              'answer_d',
  'answere':              'answer_e',
  'difficulty':           'difficulty',
  'difficultydynamic':    '_skip_',
  'discriminationindex':  '_skip_',
  'averagetimeseconds':   '_skip_',
  'explanationtext':      'explanation',
  'explanationmedia':     'explanation_media',
  'isactive':             'is_active',
  'correctanswerscore':   'correct_answer_score',
  'skillscore_grammar':       'skill_grammar',
  'skillscore_spelling':      'skill_spelling',
  'skillscore_vocabulary':    'skill_vocabulary',
  'skillscore_reading':       'skill_reading',
  'skillscore_writing':       'skill_writing',
  'skillscore_algebra':       'skill_algebra',
  'skillscore_wordproblems':  'skill_word_problems',
  'skillscore_geometry':      'skill_geometry',
  'skillscore_statistics':    'skill_statistics',
  'skillscore_mentalmaths':   'skill_mental_maths',
  'skillscore_problemsolving':'skill_problem_solving',
  'skillscore_numericalreasoning':'skill_numerical_reasoning',
  'skillscore_verbalreasoning':   'skill_verbal_reasoning',
  'skillscore_logicalreasoning':  'skill_logical_reasoning',
  'skillscore_criticalthinking':  'skill_critical_thinking',
  'tags': 'tags',
  // System-generated fields — skip on import
  'totalattempts':          '_skip_',
  'correctattempts':        '_skip_',
  'successrate':            '_skip_',
  'avgtimetakenseconds':    '_skip_',
  'mostcommonwronganswer':  '_skip_',
  'skiprate':               '_skip_',
  'flagcount':              '_skip_',
}

// ── Enum mappers ──
const QUESTION_TYPE_MAP: Record<string, string> = {
  'multiple choice':        'MCQ',
  'multiplechoice':         'MCQ',
  'mcq':                    'MCQ',
  'short answer':           'SHORT_ANSWER',
  'shortanswer':            'SHORT_ANSWER',
  'writing':                'WRITING',
  'readingcomprehension':   'READING_COMPREHENSION',
  'reading comprehension':  'READING_COMPREHENSION',
}

const EXAM_TYPE_MAP: Record<string, string> = {
  'naplanstylereading':               'NAPLAN_STYLE_READING',
  'naplan_style_reading':             'NAPLAN_STYLE_READING',
  'naplanstylenumeracy':              'NAPLAN_STYLE_NUMERACY',
  'naplan_style_numeracy':            'NAPLAN_STYLE_NUMERACY',
  'naplanstylelanguageconvention':    'NAPLAN_STYLE_LANGUAGE_CONVENTION',
  'naplan_style_language_convention': 'NAPLAN_STYLE_LANGUAGE_CONVENTION',
  'selective':            'SELECTIVE',
  'mathsolympiad':        'MATHS_OLYMPIAD',
  'maths_olympiad':       'MATHS_OLYMPIAD',
  'englisholympiad':      'ENGLISH_OLYMPIAD',
  'english_olympiad':     'ENGLISH_OLYMPIAD',
  'benchmark':            'BENCHMARK',
  'grammar':              'GRAMMAR',
  'verbalreasoning':      'VERBAL_REASONING',
  'verbal reasoning':     'VERBAL_REASONING',
  'numericalreasoning':   'NUMERICAL_REASONING',
  'numerical reasoning':  'NUMERICAL_REASONING',
  'spelling':             'SPELLING',
  'mentalmaths':          'MENTAL_MATHS',
  'mental maths':         'MENTAL_MATHS',
  'geometry':             'GEOMETRY',
  'wordproblems':         'WORD_PROBLEMS',
  'word problems':        'WORD_PROBLEMS',
  'problemsolving':       'PROBLEM_SOLVING',
  'problem solving':      'PROBLEM_SOLVING',
  'criticalthinking':     'CRITICAL_THINKING',
  'critical thinking':    'CRITICAL_THINKING',
  'vocabulary':           'VOCABULARY',
}

// ── Robust CSV parser (handles quoted fields with commas & newlines) ──
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i++ // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(cell.trim())
        cell = ''
      } else if (ch === '\r' && next === '\n') {
        row.push(cell.trim())
        cell = ''
        if (row.some(c => c !== '')) rows.push(row)
        row = []
        i++ // skip \n
      } else if (ch === '\n') {
        row.push(cell.trim())
        cell = ''
        if (row.some(c => c !== '')) rows.push(row)
        row = []
      } else {
        cell += ch
      }
    }
  }

  // Last cell / row
  row.push(cell.trim())
  if (row.some(c => c !== '')) rows.push(row)

  return rows
}

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['TEST_CREATOR', 'ADMIN'])

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const text = await file.text()
    const rows = parseCSV(text)

    if (rows.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 })
    }

    // Normalize header row
    const headers = rows[0].map(h =>
      h.replace(/[\s_]/g, '').toLowerCase()
    )

    const dataRows = rows.slice(1)
    const admin = createAdminClient()

    const results = {
      total: dataRows.length,
      inserted: 0,
      errors: [] as { row: number; message: string }[]
    }

    for (let i = 0; i < dataRows.length; i++) {
      const csvRow = dataRows[i]
      const rowNum = i + 2 // 1-indexed header + offset

      try {
        const record: Record<string, unknown> = {
          created_by: user.id,
          status: 'DRAFT',
          tags: [], // Default to empty array to satisfy NOT NULL constraint
        }

        for (let j = 0; j < headers.length; j++) {
          const csvKey = headers[j]
          const dbCol = CSV_TO_DB[csvKey]

          if (!dbCol || dbCol === '_skip_' || j >= csvRow.length) continue

          let value: unknown = csvRow[j]
          if (value === '' || value === undefined) continue

          // Type conversions
          if (dbCol === 'type') {
            const mapped = QUESTION_TYPE_MAP[(value as string).toLowerCase()]
            if (!mapped) {
              results.errors.push({ row: rowNum, message: `Unknown question type: "${value}"` })
              continue
            }
            value = mapped
          } else if (dbCol === 'exam_type') {
            const mapped = EXAM_TYPE_MAP[(value as string).toLowerCase().replace(/[\s_]/g, '')]
            if (!mapped) {
              results.errors.push({ row: rowNum, message: `Unknown exam type: "${value}"` })
              continue
            }
            value = mapped
          } else if (dbCol === 'year_level' || dbCol === 'difficulty' || dbCol === 'correct_answer_score') {
            value = parseInt(value as string)
            if (isNaN(value as number)) continue
          } else if (dbCol === 'is_active') {
            const v = (value as string).toLowerCase()
            value = v === '1' || v === 'true' || v === 'yes'
          } else if (dbCol.startsWith('skill_')) {
            value = parseFloat(value as string)
            if (isNaN(value as number)) value = 0
          } else if (dbCol === 'tags') {
            // Handle tags as a comma-separated list converted to a JSON array
            value = (value as string).split(',').map(t => t.trim()).filter(t => t !== '')
          }

          record[dbCol] = value
        }

        // Validate mandatory fields
        if (!record.stem) {
          results.errors.push({ row: rowNum, message: 'Missing question text (Question Text)' })
          continue
        }
        if (!record.type) {
          results.errors.push({ row: rowNum, message: 'Missing question type' })
          continue
        }

        const { data: insertedQuestion, error: insertErr } = await admin.from('questions').insert(record).select().single()

        if (insertErr) {
          results.errors.push({ row: rowNum, message: insertErr.message })
        } else {
          // Map to test_questions if exam_id is provided
          if (record.exam_id) {
            const { error: mappingErr } = await admin.from('test_questions').insert({
              test_id: record.exam_id,
              question_id: insertedQuestion.id,
              section_name: record.exam_section || 'General',
              base_difficulty: record.difficulty || 2
            })
            if (mappingErr) {
               console.error("Failed to map question to test:", mappingErr)
            }
          }
          results.inserted++
        }
      } catch (rowErr) {
        results.errors.push({
          row: rowNum,
          message: rowErr instanceof Error ? rowErr.message : 'Unexpected error while importing this row',
        })
      }
    }

    return NextResponse.json(results)

  } catch (err) {
    console.error('[creator-upload]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'The import failed unexpectedly.' },
      { status: 500 }
    )
  }
}
