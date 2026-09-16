import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Only ADMINs can change roles
    await requireRole(['ADMIN'])
    
    const { id } = await params
    const { role } = await req.json()
    
    if (!role || !['STUDENT', 'PARENT', 'TUTOR', 'TEST_CREATOR', 'ADMIN'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Update or Insert the role using upsert
    const { error } = await adminClient
      .from('app_user_roles')
      .upsert({ user_id: id, role })
      
    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
}
