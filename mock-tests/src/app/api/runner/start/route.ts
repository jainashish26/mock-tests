import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])
    const { assignmentId } = await req.json()

    if (!assignmentId) return NextResponse.json({ error: 'Missing assignmentId' }, { status: 400 })

    const supabase = await createClient()

    // Get student profile
    const { data: profile } = await supabase.from('student_profiles').select('id').eq('auth_user_id', user.id).single()
    if (!profile) throw new Error('Student profile not found')

    // Find assignment
    const { data: assignment } = await supabase.from('assignments').select('*, tests(id, time_limit_mins)').eq('id', assignmentId).single()
    
    if (!assignment) throw new Error('Assignment not found')

    // Start attempt
    const { data: attempt, error } = await supabase.from('attempts').insert({
      student_id: profile.id,
      test_id: assignment.test_id,
      status: 'IN_PROGRESS'
    }).select('id').single()

    if (error) throw error

    return NextResponse.json({ success: true, attemptId: attempt.id })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
}
