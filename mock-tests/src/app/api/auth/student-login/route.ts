import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
    }

    const supabase = await createClient()
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

    return NextResponse.json({ success: true })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
