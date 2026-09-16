import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    await requireRole(['STUDENT'])
    const { attemptId, questionId, sectionName, answer } = await req.json()

    const supabase = await createClient()

    // RLS ensures only attempt owner can write responses
    const { error } = await supabase.from('responses').upsert({
      attempt_id: attemptId,
      question_id: questionId,
      section_name: sectionName,
      difficulty_served: 1, // Defaulting to 1 for this MVP mock
      answer: answer
    }, { onConflict: 'attempt_id, question_id' })

    if (error) throw error

    return NextResponse.json({ success: true })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
}
