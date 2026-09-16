import { createClient } from '../supabase/server'
import { getUserRole } from './get-user-role'
import type { UserRole } from '@/types'
import { redirect } from 'next/navigation'

export async function requireRole(allowedRoles: UserRole[]) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }
  
  const userRole = await getUserRole(user.id)
  
  if (!userRole || !allowedRoles.includes(userRole)) {
    redirect('/')
  }
  
  return { user, userRole }
}
