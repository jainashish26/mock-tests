/**
 * Seeds the writing_prompts table from the in-code MECE catalog (Years 2-9).
 * Idempotent: skips when the table already has rows. Run from the mock-tests dir:
 *   node --import ./scripts/ts-register.mjs scripts/seed-writing-prompts.mts
 *
 * The prompts are owned by the Quiz Master (TEST_CREATOR) account so it can
 * manage them, and published so the AI Practice Lab serves them immediately.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import { WRITING_PROMPTS } from '@/lib/writing/prompts-catalog'

const envFile = fs.readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envFile
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const [key, ...val] = line.split('=')
      return [key.trim(), val.join('=').trim().replace(/^"(.*)"$/, '$1')]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Quiz Master (TEST_CREATOR) account — see scripts/create-creator.mjs.
const CREATOR_ID = 'f34c58ab-46a4-4693-8bb1-f36de4da0f46'

async function main() {
  const { count, error: countErr } = await supabase
    .from('writing_prompts')
    .select('*', { count: 'exact', head: true })
  if (countErr) {
    console.error('Could not read writing_prompts:', countErr.message)
    process.exit(1)
  }
  if ((count ?? 0) > 0) {
    console.log(`writing_prompts already has ${count} rows; skipping seed.`)
    return
  }

  const rows = WRITING_PROMPTS.map((p) => ({
    year_level: p.year,
    territory: p.territory,
    type: p.type,
    text: p.text,
    status: 'PUBLISHED',
    created_by: CREATOR_ID,
  }))

  const { error } = await supabase.from('writing_prompts').insert(rows)
  if (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }
  console.log(`Seeded ${rows.length} writing prompts (Years 2-9, published).`)
}

main()