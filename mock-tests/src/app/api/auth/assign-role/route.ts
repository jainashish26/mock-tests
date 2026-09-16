import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await request.json()

    if (!userId || !role) {
      return NextResponse.json({ message: 'userId and role are required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from('app_user_roles').insert({ user_id: userId, role })

    if (error) {
      console.error('Role assignment error:', error)
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Unexpected error in assign-role:', err)
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 })
  }
}
