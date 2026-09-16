import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

const FLOWERS = ['Rose', 'Tulip', 'Daisy', 'Lily', 'Iris', 'Poppy']
const FRUITS = ['Apple', 'Mango', 'Berry', 'Peach', 'Kiwi', 'Plum']

export async function POST(req: Request) {
  try {
    const { user, userRole } = await requireRole(['PARENT'])
    
    const body = await req.json()
    const yearLevel = parseInt(body.yearLevel)
    const password = body.password

    if (!yearLevel || yearLevel < 2 || yearLevel > 8 || !password) {
      return NextResponse.json({ error: 'Invalid year level or password' }, { status: 400 })
    }

    // Enforce 4-student limit for parents
    const admin = createAdminClient()
    const { count } = await admin
      .from('parent_student_links')
      .select('*', { count: 'exact', head: true })
      .eq('parent_user_id', user.id)

    if ((count ?? 0) >= 4) {
      return NextResponse.json({ error: 'Maximum of 4 student profiles reached. Please upgrade your plan.' }, { status: 403 })
    }

    // Generate unique username
    let username = ''
    let isUnique = false
    let attempts = 0
    
    while (!isUnique && attempts < 10) {
      const f1 = FLOWERS[Math.floor(Math.random() * FLOWERS.length)]
      const f2 = FRUITS[Math.floor(Math.random() * FRUITS.length)]
      const digits = Math.floor(1000 + Math.random() * 9000).toString()
      username = `${f1}${f2}${digits}`

      const { data } = await admin.from('student_profiles').select('id').eq('username', username).single()
      if (!data) isUnique = true
      attempts++
    }

    if (!isUnique) {
      return NextResponse.json({ error: 'Could not generate unique username' }, { status: 500 })
    }

    const syntheticEmail = `${username}@students.mocktest.internal`

    // Create auth user
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: password,
      email_confirm: true // bypass email confirmation
    })

    if (authErr || !authUser.user) throw new Error(authErr?.message || 'Auth user creation failed')

    const childId = authUser.user.id

    // Insert role
    await admin.from('app_user_roles').insert({ user_id: childId, role: 'STUDENT' })

    // Insert student profile
    const { data: profile, error: profileErr } = await admin.from('student_profiles').insert({
      auth_user_id: childId,
      year_level: yearLevel,
      username: username
    }).select('id').single()

    if (profileErr) throw profileErr

    // Link to parent
    const { error: linkErr } = await admin.from('parent_student_links').insert({
      parent_user_id: user.id,
      student_id: profile.id
    })

    if (linkErr) throw linkErr

    return NextResponse.json({ success: true, username })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
}
