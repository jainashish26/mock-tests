import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function createUser(email, password, role) {
  try {
    console.log(`Creating user ${email} with role ${role}...`)
    
    const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: password,
      email_confirm: true
    })

    if (createError) {
      if (createError.message.includes('already registered')) {
          console.log(`User ${email} already exists in auth.users. Fetching ID...`)
          const { data: users } = await supabase.auth.admin.listUsers()
          const foundUser = users.users.find(u => u.email === email)
          if (foundUser) {
              await assignRole(foundUser.id, role)
          } else {
              console.error(`Could not find existing user ${email}`)
          }
          return
      } else {
          console.error(`Error creating user ${email}:`, createError.message)
          return
      }
    }

    if (user) {
        await assignRole(user.id, role)
    }
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
  await createUser('QuizMaster@jainashish.com', 'BravoMan123#', 'TEST_CREATOR')
}

main()
