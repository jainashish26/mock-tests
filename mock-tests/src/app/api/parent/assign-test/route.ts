import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['PARENT'])
    
    const { studentId, testId } = await req.json()

    if (!studentId || !testId) {
      return NextResponse.json({ error: 'Missing student or test' }, { status: 400 })
    }

    const supabase = await createClient()

    // Enforce logic: insert triggers RLS
    // The policy "Parent can insert assignments" requires:
    // public.is_parent_of(student_id) AND assigned_by = auth.uid()
    const { error } = await supabase.from('assignments').insert({
      student_id: studentId,
      test_id: testId,
      assigned_by: user.id
    })

    if (error) {
      console.error(error)
      return NextResponse.json({ error: 'Cannot assign test. ' + error.message }, { status: 403 })
    }

    return NextResponse.json({ success: true })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 401 })
  }
}
