import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request, { params }: { params: Promise<{ entity: string, id: string }> }) {
  try {
    const { user } = await requireRole(['ADMIN'])
    
    // In next 15+, params is a promise
    const { entity, id } = await params
    
    if (entity !== 'questions' && entity !== 'tests') {
      return NextResponse.json({ error: 'Invalid entity' }, { status: 400 })
    }

    const { action } = await req.json()
    const isApprove = action === 'approve'

    const supabase = await createClient()

    const updatePayload: any = {
      status: isApprove ? 'PUBLISHED' : 'DRAFT',
      updated_at: new Date().toISOString()
    }

    if (entity === 'tests' && isApprove) {
      updatePayload.published_at = new Date().toISOString()
      updatePayload.approved_by = user.id

      // Publish all questions mapped to this test
      const { data: mappings } = await supabase.from('test_questions').select('question_id').eq('test_id', id)
      if (mappings && mappings.length > 0) {
        const questionIds = mappings.map(m => m.question_id)
        await supabase.from('questions').update({ status: 'PUBLISHED' }).in('id', questionIds)
      }
    }

    const { error } = await supabase
      .from(entity)
      .update(updatePayload)
      .eq('id', id)

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
}
