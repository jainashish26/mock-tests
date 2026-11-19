/**
 * Single source of truth for site-wide SEO / GEO configuration.
 *
 * Every canonical URL, brand string and social profile is defined here so that
 * metadata, sitemap.ts, robots.ts, llms.txt and JSON-LD never drift apart.
 *
 * ⚠️ ORIGIN RESOLUTION — AND WHY THERE IS NO HARDCODED DOMAIN ANY MORE
 *   Until 2026-11-20 this module ended its fallback chain with a literal
 *   `https://mocktestspro.com.au`. That domain was never purchased; it was a
 *   placeholder from the original brief. It was also unreachable by config:
 *   every environment sets `NEXT_PUBLIC_APP_URL`, but this module read
 *   `NEXT_PUBLIC_SITE_URL` — a variable that exists nowhere — so the fallback
 *   won, and production was emitting canonical tags, OG URLs, JSON-LD
 *   `Organization.url`, a sitemap reference and a `Host:` directive for a domain
 *   that does not resolve. The SEO validator did not catch it; it asserted the
 *   fictional value and therefore *enforced* it.
 *
 *   So the chain now reads real configuration, and the last resort is the local
 *   origin rather than a confident wrong one. A canonical pointing at localhost
 *   in a production build is loudly wrong and gets fixed; one pointing at a
 *   plausible-looking dead domain looks fine and does not.
 */

// Only the type, so this module stays free of any runtime dependency on Next.
import type { Metadata } from 'next';


/** Strip any trailing slash so `${SITE_URL}/path` cannot produce `//path`. */
function normaliseOrigin(value: string | undefined | null): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Vercel provides this automatically for every deployment on its build host. */
const VERCEL_ORIGIN = process.env.NEXT_PUBLIC_VERCEL_URL
  ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  : null

/**
 * The public origin. Resolution order, most explicit first:
 *   1. NEXT_PUBLIC_SITE_URL  — the intended permanent production domain
 *   2. NEXT_PUBLIC_APP_URL   — already set in every environment today
 *   3. NEXT_PUBLIC_VERCEL_URL — the deployment's own *.vercel.app origin
 *   4. the local dev origin
 */
export const SITE_URL =
  normaliseOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
  normaliseOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
  normaliseOrigin(VERCEL_ORIGIN) ??
  'http://localhost:3000'

/**
 * Is this origin allowed to be indexed?
 *
 * TRUE unless the origin is a `*.vercel.app` deployment host or a loopback
 * address — and overridable in both directions with `NEXT_PUBLIC_INDEXABLE`.
 *
 * Deriving it rather than requiring a flag is the point. The business decision
 * taken on 2026-11-20 was "stay on the Vercel URL until the real domain is
 * bought, and index properly once it exists." A flag would make that a manual
 * two-step — buy the domain, remember to flip the flag — and the failure mode of
 * forgetting is that the product's real home is silently unindexable while the
 * throwaway origin is not. Deriving it means the cutover happens by itself the
 * moment `NEXT_PUBLIC_SITE_URL` is set, with nothing left to remember.
 *
 * Why not simply let Vercel handle this: Vercel's automatic `x-robots-tag:
 * noindex` covers *preview* deployments only. A **production** deployment served
 * from `*.vercel.app` is fully indexable unless the app says otherwise, and this
 * app is deployed to production on exactly such a host.
 *
 * `metadata.robots` is per-page, so this value is consumed by
 * `INDEXABLE_ROBOTS` below — see that comment for why setting it once in the
 * root layout is not enough.
 */
const NON_INDEXABLE_HOST = /(^|\/\/)([^/]+\.)?vercel\.app$|(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i

function resolveIndexable(): boolean {
  const explicit = process.env.NEXT_PUBLIC_INDEXABLE?.trim().toLowerCase()
  if (explicit === 'true' || explicit === '1') return true
  if (explicit === 'false' || explicit === '0') return false
  return !NON_INDEXABLE_HOST.test(SITE_URL)
}

export const INDEXABLE = resolveIndexable()

/**
 * The bare hostname for display, or `null` when the origin is not a real domain.
 *
 * Used where the site previously printed the literal `mocktestspro.com.au` — on
 * the Open Graph card, which is the one surface that shows the address to people
 * rather than to crawlers, so a placeholder here is a shared image telling a
 * parent to visit a domain that does not resolve.
 *
 * A `*.vercel.app` host is a genuine address but a poor thing to print: it is
 * long, it is not the brand, and it advertises that the product is provisional.
 * `SITE_NAME` is already on the card, so when there is no real domain the right
 * move is to show nothing rather than to show either a fiction or a hostname.
 */
export const BRAND_HOST_LABEL: string | null = (() => {
  if (!INDEXABLE) return null
  const host = SITE_URL.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  return host.includes('/') ? null : host
})()


/**
 * `robots` metadata for a page that SHOULD be indexed when the origin may be.
 *
 * Carries the `googleBot` sub-directive rather than leaving it to the layout,
 * because the two are resolved together and a page that sets `robots` without
 * `googleBot` gets Google's defaults for image previews and snippets — the exact
 * settings the root layout used to spell out. Blog articles previously declared
 * the whole block themselves; they now get it from here, so the permissive case
 * is identical wherever it appears and the restrictive case cannot be half-applied.
 *
 * WHY EVERY PUBLIC PAGE MUST USE THIS RATHER THAN SPELLING IT OUT
 *   Six public surfaces wrote `robots: { index: true, follow: true }` (or the
 *   longer form with `googleBot`) literally: /blog, /contact, /privacy-policy,
 *   /terms, every blog article, and every category hub. Next.js resolves
 *   `metadata.robots` per page, and a page-level declaration wins over the
 *   layout's. So a root-layout noindex would have been silently defeated on
 *   precisely the pages carrying the most indexable weight — the fifty-odd
 *   articles and their category hubs are the entire reason the site has organic
 *   search traffic — while looking applied everywhere else. The build validator
 *   caught exactly that: after the layout was fixed, `/` and `/contact` emitted
 *   `noindex, nofollow` and the articles still emitted `index, follow`.
 *
 *   Pages that are never public (`/onboarding`, `/parent/offer`,
 *   `/parent/readiness/[childId]`, `/parent/refer`) keep their own explicit
 *   noindex, and `/r/[code]` keeps `index: false, follow: true` deliberately:
 *   thousands of near-duplicate referral landing pages must not dilute the
 *   canonical marketing pages, but blocking them from *following* would strand
 *   the targets they link to. Those are correct as written and are not this
 *   constant's business.
 */
export const INDEXABLE_ROBOTS: NonNullable<Metadata['robots']> = INDEXABLE
  ? {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    }
  : {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    };


/** Canonical brand name used in titles, schema and llms.txt. */
export const SITE_NAME = 'MockTests Pro';

/** Legal / organisation entity name. */
export const ORGANISATION_NAME = 'MockTests Pro';


/** Short, factual brand description reused across schema + llms.txt. */
export const SITE_TAGLINE =
  'Australian exam preparation platform for NAPLAN, Selective School and Scholarship tests for Years 3-8.';

/**
 * Default social card. Served by `src/app/opengraph-image.tsx`, which renders
 * the image dynamically - there is no static binary to keep in sync.
 */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph-image`;

/** Square brand mark, rendered dynamically by `src/app/icon-512.png/route.tsx`. */
export const LOGO_IMAGE = `${SITE_URL}/icon-512.png`;


export const LOCALE = 'en_AU';

/**
 * Social / third-party profiles. Used for schema.org `sameAs`, which is how
 * Google and AI engines corroborate entity identity and brand authority.
 * Only add profiles that genuinely exist - a dead sameAs URL is worse than none.
 */
export const SOCIAL_PROFILES: string[] = [];

/**
 * Authoritative third-party sources cited across the blog. Linking to primary
 * sources is a core GEO ranking signal (Perplexity and Google AI Overviews
 * favour pages that cite verifiable data).
 */
export const AUTHORITATIVE_SOURCES = [
  { name: 'NAPLAN - Australian Curriculum, Assessment and Reporting Authority (ACARA)', url: 'https://www.nap.edu.au/' },
  { name: 'ACARA - Australian Curriculum', url: 'https://www.acara.edu.au/' },
  { name: 'Victorian Department of Education', url: 'https://www.vic.gov.au/education' },
  { name: 'NSW Department of Education - Selective High Schools', url: 'https://education.nsw.gov.au/public-schools/selective-high-schools-and-opportunity-classes' },
  { name: 'Australian Bureau of Statistics - Education', url: 'https://www.abs.gov.au/education' },
] as const;

/** Primary navigation, used for SiteNavigationElement schema and footer links. */
export const MAIN_NAV = [
  { name: 'Features', url: `${SITE_URL}/features` },
  { name: 'Pricing', url: `${SITE_URL}/pricing` },
  { name: 'Paid Tests', url: `${SITE_URL}/tests` },
  { name: 'Free Tests', url: `${SITE_URL}/free` },
  { name: 'About Us', url: `${SITE_URL}/about` },
  { name: 'Blog', url: `${SITE_URL}/blog` },
] as const;

/**
 * Contact channels.
 *
 * WHY THE ADDRESSES ARE OPTIONAL NOW
 *   `support@mocktestspro.com.au` and `privacy@mocktestspro.com.au` were
 *   hardcoded here and rendered into the Privacy Policy, the Terms, the footer,
 *   `/contact`, the JSON-LD `contactPoint`, and — most consequentially — the
 *   **default outbound `From:` address** in `lib/email/provider.ts`. The domain
 *   was never purchased, so every one of those was a dead mailbox.
 *
 *   That is not a cosmetic bug. A privacy policy that names an unreachable
 *   privacy contact is an Australian Privacy Principles problem (APP 1.4 requires
 *   a means of contact that works), and this module's own previous comment said
 *   so: "these addresses must be real, monitored mailboxes before launch. A
 *   privacy policy that names an unreachable address is worse than none." It was
 *   believed, and then the fictional value shipped anyway — because a string
 *   literal is easier to write than a config lookup with no default.
 *
 *   There is no default any more. Set `SUPPORT_EMAIL` / `PRIVACY_EMAIL` when real
 *   mailboxes exist; until then these are `null` and every surface that used them
 *   falls back to the web form, which since migration 103 is a *better* channel
 *   anyway: it produces a tracked enquiry with a reference number, a response
 *   clock and an audit trail, where an email to a shared inbox produces none of
 *   those.
 *
 * `responseTime` stays a plain string because it is a promise, and the promise is
 * now measurable: `reporting.enquiry_thresholds.first_response_sla_minutes` is the
 * number the SLA queue computes against, so this copy and that config can be
 * checked against each other rather than allowed to drift.
 */
function configuredEmail(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  // Reject an obviously unusable value at the boundary rather than rendering it
  // into a legal page. `mail:` passed the old code happily.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) ? trimmed : null
}

export const CONTACT = {
  supportEmail: configuredEmail(process.env.SUPPORT_EMAIL),
  privacyEmail: configuredEmail(process.env.PRIVACY_EMAIL),
  /** Typical first-response window, stated on the Contact page. */
  responseTime: 'one business day',
  country: 'Australia',
} as const

/**
 * True when at least one email address is configured.
 *
 * Exported because several pages need to choose between "email us" and "use the
 * form" and they must all make the *same* choice. Two pages deciding independently
 * is how the footer advertises a mailbox the privacy policy has stopped naming.
 */
export const HAS_EMAIL_CONTACT =
  CONTACT.supportEmail !== null || CONTACT.privacyEmail !== null
;

/** Legal page routes, referenced from the footer and cross-linked. */
export const LEGAL_ROUTES = {
  privacy: '/privacy-policy',
  terms: '/terms',
  contact: '/contact',
} as const;

/** ISO revision date shown as "Last updated" on the legal pages. */
export const LEGAL_LAST_UPDATED = '2026-08-01';

/** Join an internal path onto the site origin to produce an absolute URL. */
export function absoluteUrl(path: string = '/'): string {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${clean === '/' ? '' : clean}`;
}

/** Convert a possibly-relative image src into an absolute URL for schema/OG. */
export function absoluteImageUrl(src?: string | null): string {
  if (!src) return DEFAULT_OG_IMAGE;
  return absoluteUrl(src);
}
