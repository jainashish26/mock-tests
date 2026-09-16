import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['TEST_CREATOR'])
    const payload = await req.json()
    const supabase = await createClient()

    const { data, error } = await supabase.from('tests').insert({
      ...payload,
      created_by: user.id
    }).select('id').single()

    if (error) throw error

    return NextResponse.json({ success: true, id: data.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
