import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// WARNING: Bypasses RLS. Use ONLY in trusted backend environments
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
