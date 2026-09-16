import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envFile = fs.readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(line => line.trim() && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const [key, ...val] = line.split('=')
      return [key.trim(), val.join('=').trim().replace(/^"(.*)"$/, '$1')]
    })
)

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

console.log('Supabase URL:', supabaseUrl)
console.log('Service Key starts with:', supabaseServiceKey?.substring(0, 10))

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function createUser(email, role) {
  try {
    console.log(`Creating user ${email} with role ${role}...`)
  
  const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: 'Password123!',
    email_confirm: true
  })

  if (createError) {
    if (createError.message.includes('already registered')) {
        console.log(`User ${email} already exists in auth.users. Fetching ID...`)
        const { data: existingUser } = await supabase.from('auth.users').select('id').eq('email', email).single()
        // Note: auth.users might not be accessible via regular client even with service key in some configs, 
        // but admin client can usually handle it. 
        // Let's try to just update if it exists or use the user from createUser if it returned something.
    } else {
        console.error(`Error creating user ${email}:`, createError.message)
        return
    }
  }

  const userId = user?.id
  if (!userId) {
     // Try to find the user if they already exist
     const { data: { users } } = await supabase.auth.admin.listUsers()
     const foundUser = users.find(u => u.email === email)
     if (foundUser) {
         console.log(`Found existing user ID: ${foundUser.id}`)
         await assignRole(foundUser.id, role)
     } else {
         console.error(`Could not find or create user ${email}`)
     }
     return
  }

    await assignRole(userId, role)
  } catch (err) {
    console.error(`Unexpected error in createUser for ${email}:`, err)
  }
}

async function assignRole(userId, role) {
    const { error: roleError } = await supabase
    .from('app_user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id' })

  if (roleError) {
    console.error(`Error assigning role ${role} to user ${userId}:`, roleError.message)
  } else {
    console.log(`Successfully assigned role ${role} to user.`)
  }
}

async function main() {
  await createUser('gmail@jainashish.com', 'ADMIN')
  await createUser('tutor@jainashish.com', 'TUTOR')
}

main()
