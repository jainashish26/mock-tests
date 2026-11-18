import * as React from 'react'
import { notFound } from 'next/navigation'
import { FileQuestion } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import { formatDate, previewText, yearRange } from '@/features/creator/format'
import { examTypeLabel, questionTypeLabel } from '@/lib/creator/content-meta'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

import { ReviewActions } from '../../ReviewActions'

export const dynamic = 'force-dynamic'

const TEST_COLUMNS =
  'id, title, exam_type, year_level_min, year_level_max, time_limit_mins, is_free, status, created_by, approved_by, published_at, created_at, updated_at'

const QUESTION_COLUMNS =
  'id, stem, type, status, exam_id, exam_type, exam_section, subject, topic, sub_topic, year_level, difficulty, comprehension_text, image_url, correct_answer, answer_a, answer_b, answer_c, answer_d, answer_e, explanation, explanation_steps, tags, is_active, created_by, created_at, updated_at'

interface TestRow {
  id: string
  title: string
  exam_type: string | null
  year_level_min: number | null
  year_level_max: number | null
  time_limit_mins: number | null
  is_free: boolean | null
  status: string
  created_by: string | null
  approved_by: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

interface MappedQuestion {
  order: number
  sectionName: string | null
  baseDifficulty: number | null
  question: { id: string; stem: string | null; type: string | null; status: string }
}

interface QuestionRow {
  id: string
  stem: string | null
  type: string | null
  status: string
  exam_id: string | null
  exam_type: string | null
  exam_section: string | null
  subject: string | null
  topic: string | null
  sub_topic: string | null
  year_level: number | null
  difficulty: number | null
  comprehension_text: string | null
  image_url: string | null
  correct_answer: string | null
  answer_a: string | null
  answer_b: string | null
  answer_c: string | null
  answer_d: string | null
  answer_e: string | null
  explanation: string | null
  explanation_steps: unknown
  tags: unknown
  is_active: boolean | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Best-effort email lookup — a deleted creator must not break the page. */
async function lookupEmail(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null
  const { data, error } = await adminClient.auth.admin.getUserById(userId)
  return error ? null : (data.user?.email ?? null)
}

/** Local presentational helpers, same convention as the dashboard's cards. */
function Card({
  title,
  action,
  className,
  children,
}: {
  title?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4 shadow-xs', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className={title ? 'mt-3' : undefined}>{children}</div>
    </section>
  )
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{children}</dd>
    </div>
  )
}

/**
 * Test review detail: overview facts on the left, the mapped question list on
 * the right, with the moderation actions in the page header. The question list
 * matters for approval because `POST /api/admin/review/tests/[id]` publishes
 * every mapped question along with the test.
 */
function TestReview({
  test,
  questions,
  creatorEmail,
  approverEmail,
}: {
  test: TestRow
  questions: MappedQuestion[]
  creatorEmail: string | null
  approverEmail: string | null
}) {
  const unpublished = questions.filter((mapped) => mapped.question.status !== 'PUBLISHED').length

  return (
    <>
      <PageHeader
        title={test.title}
        description="Full test record for moderation — approving publishes the test and its mapped questions."
        backHref="/admin/review/tests"
        backLabel="Review tests"
        actions={
          <ReviewActions
            entity="tests"
            id={test.id}
            status={test.status}
            title={test.title}
            questionCount={questions.length}
          />
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={test.status} />
            <Badge variant="outline">{examTypeLabel(test.exam_type)}</Badge>
            {test.is_free ? <Badge variant="success">Free</Badge> : <Badge variant="outline">Paid</Badge>}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Overview" className="lg:col-span-1">
          <dl className="divide-y divide-border">
            <MetaRow label="Exam type">{examTypeLabel(test.exam_type)}</MetaRow>
            <MetaRow label="Year levels">
              {yearRange(test.year_level_min, test.year_level_max)}
            </MetaRow>
            <MetaRow label="Time limit">
              {test.time_limit_mins ? `${test.time_limit_mins} min` : '—'}
            </MetaRow>
            <MetaRow label="Questions mapped">{questions.length}</MetaRow>
            <MetaRow label="Created by">{creatorEmail ?? '—'}</MetaRow>
            <MetaRow label="Approved by">{approverEmail ?? '—'}</MetaRow>
            <MetaRow label="Published">{formatDate(test.published_at)}</MetaRow>
            <MetaRow label="Created">{formatDate(test.created_at)}</MetaRow>
            <MetaRow label="Last updated">{formatDate(test.updated_at)}</MetaRow>
          </dl>
        </Card>

        <Card
          title={`Questions (${questions.length})`}
          className="lg:col-span-2"
          action={
            unpublished > 0 && test.status === 'PENDING_APPROVAL' ? (
              <span className="text-xs text-muted-foreground">
                {unpublished} not yet published — approval publishes them too
              </span>
            ) : null
          }
        >
          {questions.length === 0 ? (
            <EmptyState
              compact
              icon={<FileQuestion size={20} aria-hidden="true" />}
              title="No questions mapped"
              description="This test is empty. Publishing it would put a test with no questions in front of students."
            />
          ) : (
            <ol className="space-y-2">
              {questions.map((mapped, index) => (
                <li
                  key={mapped.question.id}
                  className="flex items-start gap-3 rounded-lg border border-border p-3"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {mapped.order === Number.MAX_SAFE_INTEGER ? index + 1 : mapped.order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {previewText(mapped.question.stem, 110)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{questionTypeLabel(mapped.question.type)}</span>
                      {mapped.sectionName ? <span>Section: {mapped.sectionName}</span> : null}
                      {mapped.baseDifficulty ? <span>Difficulty {mapped.baseDifficulty}/4</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={mapped.question.status} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  )
}

const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * Question review detail: the full stem (with passage/image when present), the
 * answer options with the correct one highlighted, the explanation, and the
 * curriculum/exam metadata a moderator needs to judge the submission.
 */
function QuestionReview({ question, creatorEmail }: { question: QuestionRow; creatorEmail: string | null }) {
  const options = [
    question.answer_a,
    question.answer_b,
    question.answer_c,
    question.answer_d,
    question.answer_e,
  ]
    .map((text, index) => ({ letter: ANSWER_LETTERS[index], text: text?.trim() ?? '' }))
    .filter((option) => option.text.length > 0)

  const correctRaw = question.correct_answer?.trim() ?? ''
  const isCorrect = (option: { letter: string; text: string }) =>
    correctRaw.length > 0 &&
    (option.letter === correctRaw.toUpperCase() || option.text.toLowerCase() === correctRaw.toLowerCase())

  const tags = toStringArray(question.tags)
  const steps = toStringArray(question.explanation_steps)
  const title = previewText(question.stem, 80)

  return (
    <>
      <PageHeader
        title={title}
        description="Full question record for moderation."
        backHref="/admin/review/questions"
        backLabel="Review questions"
        actions={
          <ReviewActions entity="questions" id={question.id} status={question.status} title={title} />
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={question.status} />
            <Badge variant="outline">{questionTypeLabel(question.type)}</Badge>
            {question.is_active === false ? <Badge variant="muted">Inactive</Badge> : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Question">
            {question.comprehension_text ? (
              <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs font-semibold text-muted-foreground">Passage</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {question.comprehension_text}
                </p>
              </div>
            ) : null}
            <p className="whitespace-pre-wrap text-sm font-medium text-foreground">
              {question.stem || '—'}
            </p>
            {question.image_url ? (
              <a
                href={question.image_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-4"
              >
                View attached image
              </a>
            ) : null}
          </Card>

          <Card title="Answer">
            {options.length > 0 ? (
              <ul className="space-y-2">
                {options.map((option) => (
                  <li
                    key={option.letter}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 text-sm',
                      isCorrect(option)
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-foreground'
                        : 'border-border text-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        isCorrect(option) ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {option.letter}
                    </span>
                    <span className="min-w-0 flex-1">{option.text}</span>
                    {isCorrect(option) ? <Badge variant="success">Correct answer</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <dl className="divide-y divide-border">
              <MetaRow label="Stored correct answer">{correctRaw || '—'}</MetaRow>
            </dl>

            {question.explanation || steps.length > 0 ? (
              <div className="mt-3 rounded-lg bg-muted/40 p-3">
                <p className="text-xs font-semibold text-muted-foreground">Explanation</p>
                {question.explanation ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{question.explanation}</p>
                ) : null}
                {steps.length > 0 ? (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground">
                    {steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-1">
          <Card title="Overview">
            <dl className="divide-y divide-border">
              <MetaRow label="Type">{questionTypeLabel(question.type)}</MetaRow>
              <MetaRow label="Exam type">{examTypeLabel(question.exam_type)}</MetaRow>
              {question.exam_id ? <MetaRow label="Source exam">{question.exam_id}</MetaRow> : null}
              {question.exam_section ? (
                <MetaRow label="Exam section">{question.exam_section}</MetaRow>
              ) : null}
              <MetaRow label="Subject">{question.subject ?? '—'}</MetaRow>
              <MetaRow label="Topic">{question.topic ?? '—'}</MetaRow>
              {question.sub_topic ? <MetaRow label="Sub-topic">{question.sub_topic}</MetaRow> : null}
              <MetaRow label="Year level">
                {question.year_level ? `Year ${question.year_level}` : '—'}
              </MetaRow>
              <MetaRow label="Difficulty">
                {question.difficulty ? `${question.difficulty}/4` : '—'}
              </MetaRow>
              <MetaRow label="Created by">{creatorEmail ?? '—'}</MetaRow>
              <MetaRow label="Created">{formatDate(question.created_at)}</MetaRow>
              <MetaRow label="Last updated">{formatDate(question.updated_at)}</MetaRow>
            </dl>
          </Card>

          {tags.length > 0 ? (
            <Card title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}

/**
 * Admin review detail — `/admin/review/[entity]/[id]`.
 *
 * The dashboard queue cards and both review lists deep-link here for the full
 * record: a structured page (not raw JSON) with the moderation actions in the
 * header. The entity segment must be `tests` or `questions` (the same two the
 * review API accepts); anything else 404s. Content comes through the RLS
 * client (admin policies expose every row); creator/approver emails need the
 * service client because auth users belong to other accounts.
 */
export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>
}) {
  await requireRole(['ADMIN'])

  const { entity, id } = await params
  if (entity !== 'tests' && entity !== 'questions') notFound()

  const supabase = await createClient()
  const adminClient = createAdminClient()

  if (entity === 'tests') {
    const [{ data: test }, { data: mappings }] = await Promise.all([
      supabase.from('tests').select(TEST_COLUMNS).eq('id', id).maybeSingle(),
      supabase
        .from('test_questions')
        .select('question_order, section_name, base_difficulty, questions(id, stem, type, status)')
        .eq('test_id', id),
    ])

    if (!test) notFound()

    const questions: MappedQuestion[] = (mappings ?? [])
      .map((mapping) => ({
        order: mapping.question_order ?? Number.MAX_SAFE_INTEGER,
        sectionName: (mapping.section_name as string | null) ?? null,
        baseDifficulty: (mapping.base_difficulty as number | null) ?? null,
        question: (Array.isArray(mapping.questions)
          ? mapping.questions[0]
          : mapping.questions) as MappedQuestion['question'] | null,
      }))
      .filter((mapping): mapping is MappedQuestion => mapping.question !== null && mapping.question !== undefined)
      .sort((a, b) => a.order - b.order)

    const [creatorEmail, approverEmail] = await Promise.all([
      lookupEmail(adminClient, test.created_by),
      lookupEmail(adminClient, test.approved_by),
    ])

    return (
      <TestReview
        test={test as TestRow}
        questions={questions}
        creatorEmail={creatorEmail}
        approverEmail={approverEmail}
      />
    )
  }

  const { data: question } = await supabase
    .from('questions')
    .select(QUESTION_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (!question) notFound()

  const creatorEmail = await lookupEmail(adminClient, question.created_by)

  return <QuestionReview question={question as QuestionRow} creatorEmail={creatorEmail} />
}
