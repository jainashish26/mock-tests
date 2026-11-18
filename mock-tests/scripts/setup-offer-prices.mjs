/**
 * Create the Stripe Prices the offer catalogue needs, and write their ids back.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 *   supabase/seed/funnel_offers.sql deliberately leaves stripe_price_id NULL:
 *   the price must exist in Stripe before the row may reference it, and
 *   `canClaimOffer` / `canClaimSiblingOffer` refuse to checkout without one.
 *   This script performs the seed file's documented step ("create the price,
 *   then update the row") for every offer that still lacks one.
 *
 * SAFETY
 *   - Refuses LIVE keys unless --allow-live is passed. Creating catalogue
 *     objects in the live account is a commercial action, not a dev task.
 *   - Idempotent: offers that already carry a price id are skipped, so re-runs
 *     never duplicate Stripe objects or overwrite an admin's chosen price.
 *   - The amount comes from the offers row (offer_amount_cents), never from
 *     an argument - the same "identifier, not amount" rule checkout follows.
 *
 * Run: node scripts/setup-offer-prices.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(path) {
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    let value = line.slice(line.indexOf('=') + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...readEnv(join(ROOT, '.env.local')), ...process.env };
const secret = env.STRIPE_SECRET_KEY ?? '';
const allowLive = process.argv.includes('--allow-live');

if (!/^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(secret)) {
  console.error('STRIPE_SECRET_KEY is missing or a stub. Nothing to do.');
  process.exit(1);
}
if (secret.startsWith('sk_live_') && !allowLive) {
  console.error('Refusing to create catalogue objects against a LIVE key without --allow-live.');
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const stripe = new Stripe(secret);

const { data: offers, error } = await supabase
  .from('offers')
  .select('id, slug, name, offer_amount_cents, currency, stripe_price_id')
  .eq('active', true)
  .is('stripe_price_id', null);

if (error) {
  console.error('Could not read offers:', error.message);
  process.exit(1);
}
if (!offers || offers.length === 0) {
  console.log('Every active offer already has a Stripe price. Nothing to do.');
  process.exit(0);
}

for (const offer of offers) {
  const price = await stripe.prices.create({
    unit_amount: offer.offer_amount_cents,
    currency: String(offer.currency || 'AUD').toLowerCase(),
    product_data: { name: offer.name },
  });
  const { error: writeError } = await supabase
    .from('offers')
    .update({ stripe_price_id: price.id, updated_at: new Date().toISOString() })
    .eq('id', offer.id)
    .is('stripe_price_id', null); // never overwrite a price set concurrently

  if (writeError) {
    console.error(`Created ${price.id} for ${offer.slug} but could not write it back:`, writeError.message);
    process.exit(1);
  }
  console.log(`${offer.slug}: ${price.id} (${offer.offer_amount_cents} ${offer.currency})`);
}
console.log('Done.');