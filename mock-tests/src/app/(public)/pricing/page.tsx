import type { Metadata } from 'next'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { JsonLd } from '@/components/seo/JsonLd'
import { PricingTiers } from '@/components/pricing/PricingTiers'
import { getALaCarteProducts, getSubscriptionTier } from '@/lib/pricing/catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { absoluteUrl } from '@/lib/seo/site-config'

/**
 * /pricing
 *
 * Deliberately a STATIC route. Pricing content is identical for every visitor,
 * so prerendering it gives the fastest TTFB and immediately indexable HTML.
 * Do not call `createClient()` from `@/lib/supabase/server` here - it awaits
 * `cookies()`, which would silently flip this route to dynamic rendering. The
 * catalog is read with the service-role client instead, and per-visitor state
 * is resolved client-side in `usePricingSession`.
 *
 * `revalidate = 300` keeps Stripe price edits live within five minutes without
 * making every request hit the Stripe API.
 */
export const revalidate = 300

const TITLE = 'Pricing: Free Practice, Single Tests & Unlimited Subscription'
const DESCRIPTION =
  'Free NAPLAN practice, one-time single tests, or an Unlimited monthly or annual subscription with every premium test included for Years 3-8.'
const CANONICAL = '/pricing'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: CANONICAL },
  openGraph: {
    type: 'website',
    url: absoluteUrl(CANONICAL),
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function PricingPage() {
  // Both loaders fail soft (null / []), so a missing Stripe key or an unapplied
  // migration degrades the page instead of failing the build.
  const [tier, products] = await Promise.all([
    getSubscriptionTier(),
    getALaCarteProducts(createAdminClient()),
  ])

  const url = absoluteUrl(CANONICAL)

  // Offer schema is what lets Google and answer engines quote your real prices
  // and recognise them as recurring rather than one-off.
  const offers = tier
    ? (['monthly', 'annual'] as const).map((interval) => {
        const p = tier.prices[interval]
        return {
          '@type': 'Offer',
          url,
          name: tier.name + ' (' + interval + ')',
          price: (p.amountCents / 100).toFixed(2),
          priceCurrency: p.currency,
          availability: 'https://schema.org/InStock',
          // Recurring offers need a billing duration or they read as one-off.
          billingIncrement: interval === 'monthly' ? 'P1M' : 'P1Y',
        }
      })
    : []

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        '@id': url + '#subscription',
        name: 'Mock Tests Unlimited subscription',
        description: tier ? tier.tagline : DESCRIPTION,
        url,
        brand: { '@type': 'Brand', name: 'Mock Tests' },
        ...(offers.length > 0 ? { offers } : {}),
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((q) => ({
          '@type': 'Question',
          name: q.q,
          acceptedAnswer: { '@type': 'Answer', text: q.a },
        })),
      },
    ],
  }

  return (
    <PublicLayout>
      <JsonLd data={schema} />

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '8rem 1.5rem 5rem' }}>
        <header style={{ maxWidth: '46rem', margin: '0 auto 3rem', textAlign: 'center' }}>
          <h1
            style={{
              margin: '0 0 1rem',
              fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
            }}
          >
            Pick the way that suits your family
          </h1>
          <p style={{ margin: 0, fontSize: '1.125rem', lineHeight: 1.7, color: 'var(--muted-foreground)' }}>
            Start free, buy a single test, or go unlimited. Every option covers
            NAPLAN, Selective School, Scholarship and Olympiad practice for Years 3 to 8.
          </p>
        </header>

        <PricingTiers tier={tier} products={products} />

        <section aria-labelledby="pricing-faq" style={{ maxWidth: '46rem', margin: '5rem auto 0' }}>
          <h2 id="pricing-faq" style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem' }}>
            Pricing questions
          </h2>
          <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt style={{ fontWeight: 700, marginBottom: '0.375rem' }}>{item.q}</dt>
                <dd style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.7, color: 'var(--muted-foreground)' }}>
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </PublicLayout>
  )
}

/** Rendered as real HTML *and* emitted as FAQPage schema. */
const FAQ = [
  {
    q: 'Do I need to pay to start?',
    a: 'No. The free plan gives your child a rotating set of practice tests, a diagnostic maths assessment, one AI-marked writing sample and a parent progress report, with no card required.',
  },
  {
    q: 'What is the difference between a single test and Unlimited?',
    a: 'A single test is a one-off purchase you keep permanently. Unlimited is a subscription that unlocks every premium test across all year levels and exam types for as long as it is active.',
  },
  {
    q: 'Can I cancel my subscription?',
    a: 'Yes. Manage or cancel from the billing portal at any time. Cancelling stops the next renewal; access continues until the end of the period you have already paid for.',
  },
  {
    q: 'How does annual billing save me money?',
    a: 'Paying yearly costs less than twelve monthly payments. The exact saving is shown on this page and is calculated from the current published prices.',
  },
]