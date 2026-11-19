import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import AIPracticeClient from './client'

/**
 * AI Practice Lab - student writing practice.
 *
 * ACCESS RULE (migration 015): this page and the client below show a student
 * NO result. They pick a prompt, write, and receive only an acknowledgement;
 * the graded feedback lives on the parent/tutor report (writing_practice_sessions
 * has no student SELECT policy).
 */
export default async function AIPracticePage() {
  const { user } = await requireRole(['STUDENT'])
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('student_profiles')
    .select('username, year_level')
    .eq('auth_user_id', user.id)
    .single()

  return (
    <DashboardLayout role="STUDENT" userName={profile?.username || 'Student'}>
      <AIPracticeClient yearLevel={profile?.year_level ?? null} />
    </DashboardLayout>
  )
}
