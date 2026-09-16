import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(['TEST_CREATOR'])
    
    const { id } = await params
    const payload = await req.json()
    const supabase = await createClient()

    // RLS will enforce that TEST_CREATOR can only update their own drafts/pending
    const { error } = await supabase.from('questions').update({
      ...payload,
      updated_at: new Date().toISOString()
    }).eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
