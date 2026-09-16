import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])
    const { attemptId } = await req.json()

    const supabase = await createClient()

    // Retrieve attempt to verify ownership (RLS handles this but good to fail fast if missing)
    const { data: attempt } = await supabase.from('attempts').select('status').eq('id', attemptId).single()
    
    if (!attempt || attempt.status !== 'IN_PROGRESS') {
      return NextResponse.json({ error: 'Cannot submit' }, { status: 400 })
    }

    // Mark attempt as submitted, timestamp, etc
    const { error } = await supabase.from('attempts').update({
      status: 'SUBMITTED',
      submitted_at: new Date().toISOString()
    }).eq('id', attemptId)

    if (error) throw error

    // Run scoring synchronously for MVP (normally async if heavy)
    const { scoreAttempt } = await import('@/lib/scoring/score-attempt')
    await scoreAttempt(attemptId)

    return NextResponse.json({ success: true })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
}
