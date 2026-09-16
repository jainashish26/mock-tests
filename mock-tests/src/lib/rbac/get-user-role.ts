import { createClient } from '../supabase/server'
import type { UserRole } from '@/types'

export async function getUserRole(userId: string): Promise<UserRole | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('app_user_roles')
    .select('role')
    .eq('user_id', userId)
    .single()
    
  if (error || !data) {
    return null
  }
  
  return data.role as UserRole
}
