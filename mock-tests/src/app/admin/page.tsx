import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  ClipboardCheck,
  FileQuestion,
  FileText,
  Timer,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { formatDate, previewText } from '@/features/creator/format'
import { attemptStatusMeta, formatDollars, formatScore, roleMeta } from '@/lib/admin/display'
import { examTypeLabel, questionTypeLabel } from '@/lib/creator/content-meta'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Admin overview.
 *
 * Everything is read server-side in one parallel batch: the RLS client is used
 * for content (same pattern the rest of /admin already uses) and the service
 * client for auth users, attempts and purchases, which are student-owned rows
 * an admin would not otherwise be able to read.
 */
/**
 * ISO timestamp for "seven days ago". Hoisted out of the component so the
 * render body stays pure for react-hooks/purity while the value is still
 * computed per request (server components render once per request).
 */
function oneWeekAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * supabase-js infers FK joins as arrays when the client has no generated
 * Database type; this flattens "maybe an array" join results to a single row.
 */
function firstJoinOf<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function AdminDashboard() {
  await requireRole(['ADMIN'])

  const supabase = await createClient()
  const adminClient = createAdminClient()
  const weekAgo = oneWeekAgoIso()

  const [
    pendingTestsRes,
    pendingTestsCountRes,
    publishedTestsCountRes,
    testsCountRes,
    pendingQuestionsRes,
    pendingQuestionsCountRes,
    questionsCountRes,
    rolesRes,
    studentsCountRes,
    attemptsRes,
    attemptsCountRes,
    weekAttemptsCountRes,
    purchasesRes,
    authUsersRes,
  ] = await Promise.all([
    supabase
      .from('tests')
      .select('id, title, exam_type, updated_at')
      .eq('status', 'PENDING_APPROVAL')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase.from('tests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
    supabase.from('tests').select('id', { count: 'exact', head: true }).eq('status', 'PUBLISHED'),
    supabase.from('tests').select('id', { count: 'exact', head: true }),
    supabase
      .from('questions')
      .select('id, stem, type, updated_at')
      .eq('status', 'PENDING_APPROVAL')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
    supabase.from('questions').select('id', { count: 'exact', head: true }),
    adminClient.from('app_user_roles').select('user_id, role, created_at'),
    adminClient.from('student_profiles').select('id', { count: 'exact', head: true }),
    adminClient
      .from('attempts')
      .select('id, status, score_out_of100, started_at, tests(title), student_profiles(username)')
      .order('started_at', { ascending: false })
      .limit(5),
    adminClient.from('attempts').select('id', { count: 'exact', head: true }),
    adminClient.from('attempts').select('id', { count: 'exact', head: true }).gte('started_at', weekAgo),
    adminClient.from('purchases').select('total_amount_cents, status'),
    // GoTrue has no count endpoint; 200 users per page is ample at this scale.
    adminClient.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ])

  const pendingTests = pendingTestsRes.data ?? []
  const pendingQuestions = pendingQuestionsRes.data ?? []
  const pendingTestsCount = pendingTestsCountRes.count ?? pendingTests.length
  const pendingQuestionsCount = pendingQuestionsCountRes.count ?? pendingQuestions.length
  const pendingTotal = pendingTestsCount + pendingQuestionsCount

  const publishedTests = publishedTestsCountRes.count ?? 0
  const totalTests = testsCountRes.count ?? 0
  const totalQuestions = questionsCountRes.count ?? 0
  const totalStudents = studentsCountRes.count ?? 0
  const totalAttempts = attemptsCountRes.count ?? 0
  const weekAttempts = weekAttemptsCountRes.count ?? 0

  const roles = rolesRes.data ?? []
  const roleByUser = new Map<string, string>()
  let creatorCount = 0
  for (const row of roles) {
    roleByUser.set(row.user_id, row.role)
    if (row.role === 'TEST_CREATOR' || row.role === 'ADMIN') creatorCount += 1
  }

  const purchases = purchasesRes.data ?? []
  const completedPurchases = purchases.filter((p: { status?: string }) => p.status === 'COMPLETED')
  const revenueCents = completedPurchases.reduce(
    (sum: number, p: { total_amount_cents?: number | null }) => sum + (p.total_amount_cents ?? 0),
    0
  )

  const authUsers = authUsersRes.data?.users ?? []
  const totalUsers = authUsers.length
  const recentSignups = [...authUsers]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)

  // Flatten the join columns once so the render below stays cast-free.
  const recentAttempts = (attemptsRes.data ?? []).map(
    (attempt: {
      id: string
      status?: string | null
      score_out_of100?: number | string | null
      started_at?: string | null
      tests?: { title?: string | null }[] | { title?: string | null } | null
      student_profiles?: { username?: string | null }[] | { username?: string | null } | null
    }) => ({
      id: attempt.id,
      status: attempt.status ?? null,
      score: attempt.score_out_of100 ?? null,
      startedAt: attempt.started_at ?? null,
      testTitle: firstJoinOf(attempt.tests)?.title ?? null,
      studentName: firstJoinOf(attempt.student_profiles)?.username ?? null,
    })
  )

  return (
    <>
      <PageHeader
        title="Admin overview"
        description="Platform health, moderation queues and the latest activity — all in one place."
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="min-h-10 gap-1.5">
              <Link href="/admin/users">
                <UsersIcon size={16} />
                <span className="hidden sm:inline">Users</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-10 gap-1.5">
              <Link href="/admin/reports">
                <BarChart3 size={16} />
                <span className="hidden sm:inline">Reports</span>
              </Link>
            </Button>
            <Button asChild size="sm" className="min-h-10 gap-1.5">
              <Link href={pendingTestsCount > 0 ? '/admin/review/tests' : '/admin/review/questions'}>
                <ClipboardCheck size={16} />
                Review queue
                {pendingTotal > 0 ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/20 text-[0.6875rem] font-bold">
                    {pendingTotal}
                  </span>
                ) : null}
              </Link>
            </Button>
          </>
        }
      />

      {pendingTotal > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600">
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-foreground">
                {pendingTotal} item{pendingTotal === 1 ? '' : 's'} waiting for review
              </p>
              <p className="text-sm text-muted-foreground">
                {pendingTestsCount} test{pendingTestsCount === 1 ? '' : 's'} and {pendingQuestionsCount} question
                {pendingQuestionsCount === 1 ? '' : 's'} are pending approval.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="min-h-10 shrink-0 gap-1.5">
            <Link href={pendingTestsCount > 0 ? '/admin/review/tests' : '/admin/review/questions'}>
              Start reviewing
              <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      ) : null}

      {/* KPI grid — two across on phones, four from lg up. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<UsersIcon size={18} />}
          tone="bg-primary/10 text-primary"
          label="Registered users"
          value={String(totalUsers)}
          sub={`${totalStudents} student profile${totalStudents === 1 ? '' : 's'} · ${creatorCount} creator${creatorCount === 1 ? '' : 's'}`}
        />
        <KpiCard
          icon={<FileText size={18} />}
          tone="bg-emerald-500/10 text-emerald-600"
          label="Live tests"
          value={String(publishedTests)}
          sub={`${totalTests} total · ${totalQuestions} questions`}
        />
        <KpiCard
          icon={<Timer size={18} />}
          tone="bg-amber-500/10 text-amber-600"
          label="Test attempts"
          value={String(totalAttempts)}
          sub={`${weekAttempts} in the last 7 days`}
        />
        <KpiCard
          icon={<Banknote size={18} />}
          tone="bg-violet-500/10 text-violet-600"
          label="Revenue"
          value={formatDollars(revenueCents)}
          sub={`${completedPurchases.length} completed purchase${completedPurchases.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — the moderation queues admins act on daily. */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section aria-labelledby="queue-tests" className="rounded-xl border border-border bg-card shadow-xs">
            <SectionHeader id="queue-tests" title="Tests awaiting review" count={pendingTestsCount} href="/admin/review/tests" />
            {pendingTests.length === 0 ? (
              <EmptyState
                compact
                icon={<ClipboardCheck size={18} />}
                title="Nothing waiting"
                description="Every submitted test has been reviewed."
                action={
                  <Button asChild variant="outline" size="sm" className="min-h-10">
                    <Link href="/admin/review/tests">Browse all tests</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {pendingTests.map((test: { id: string; title: string; exam_type?: string | null; updated_at?: string | null }) => (
                  <li key={test.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 hidden shrink-0 text-primary sm:block">
                        <FileText size={18} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{test.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {examTypeLabel(test.exam_type)} · Updated {formatDate(test.updated_at)}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm" className="min-h-9 shrink-0 gap-1">
                      <Link href={`/admin/review/tests/${test.id}`}>
                        Review
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="queue-questions" className="rounded-xl border border-border bg-card shadow-xs">
            <SectionHeader id="queue-questions" title="Questions awaiting review" count={pendingQuestionsCount} href="/admin/review/questions" />
            {pendingQuestions.length === 0 ? (
              <EmptyState
                compact
                icon={<FileQuestion size={18} />}
                title="Nothing waiting"
                description="Every submitted question has been reviewed."
                action={
                  <Button asChild variant="outline" size="sm" className="min-h-10">
                    <Link href="/admin/review/questions">Browse all questions</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {pendingQuestions.map((question: { id: string; stem?: string | null; type?: string | null; updated_at?: string | null }) => (
                  <li key={question.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 hidden shrink-0 text-primary sm:block">
                        <FileQuestion size={18} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{previewText(question.stem, 80)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {questionTypeLabel(question.type)} · Updated {formatDate(question.updated_at)}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm" className="min-h-9 shrink-0 gap-1">
                      <Link href={`/admin/review/questions/${question.id}`}>
                        Review
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right column — latest activity at a glance. */}
        <div className="flex flex-col gap-6">
          <section aria-labelledby="recent-attempts" className="rounded-xl border border-border bg-card shadow-xs">
            <SectionHeader id="recent-attempts" title="Recent attempts" href="/admin/reports" />
            {recentAttempts.length === 0 ? (
              <EmptyState
                compact
                icon={<Timer size={18} />}
                title="No attempts yet"
                description="Student activity will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentAttempts.map((attempt) => {
                  const meta = attemptStatusMeta(attempt.status)
                  return (
                    <li key={attempt.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {attempt.studentName || 'Student'}
                        </p>
                        <Badge variant={meta.variant} className="shrink-0 text-[0.625rem]">
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {attempt.testTitle || 'Test removed'} · {formatDate(attempt.startedAt)}
                      </p>
                      {attempt.score !== null ? (
                        <p className="mt-0.5 text-xs font-bold text-emerald-600">
                          Score {formatScore(attempt.score)}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="new-users" className="rounded-xl border border-border bg-card shadow-xs">
            <SectionHeader id="new-users" title="New users" href="/admin/users" />
            {recentSignups.length === 0 ? (
              <EmptyState
                compact
                icon={<UserPlus size={18} />}
                title="No users yet"
                description="Sign-ups will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentSignups.map((authUser) => {
                  const meta = roleMeta(roleByUser.get(authUser.id))
                  return (
                    <li key={authUser.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{authUser.email}</p>
                        <Badge variant={meta.variant} className="shrink-0 text-[0.625rem]">
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">Joined {formatDate(authUser.created_at)}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

/* Local presentational helpers (server-only, so they stay in this file). */

function KpiCard({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  tone: string
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className={`mb-3 flex size-9 items-center justify-center rounded-lg ${tone}`} aria-hidden="true">
        {icon}
      </div>
      <p className="text-xl font-extrabold tabular-nums text-foreground sm:text-2xl">{value}</p>
      <p className="text-[0.625rem] font-bold tracking-wider text-muted-foreground uppercase">{label}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function SectionHeader({
  id,
  title,
  count,
  href,
  linkLabel = 'View all',
}: {
  id: string
  title: string
  count?: number
  href: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <h2 id={id} className="text-sm font-bold text-foreground">
        {title}
        {count !== undefined && count > 0 ? (
          <span className="ml-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-600 tabular-nums">
            {count}
          </span>
        ) : null}
      </h2>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:underline"
      >
        {linkLabel}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  )
}
