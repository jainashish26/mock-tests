/**
 * Single source of truth for site-wide SEO / GEO configuration.
 *
 * Every canonical URL, brand string and social profile is defined here so that
 * metadata, sitemap.ts, robots.ts, llms.txt and JSON-LD never drift apart.
 */

/** Production origin. Must have no trailing slash. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
  'https://mocktestspro.com.au';

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
 * Contact details. Used by the Contact page, the Privacy Policy, the footer and
 * the Organization JSON-LD `contactPoint` so they can never disagree.
 *
 * IMPORTANT: these addresses must be real, monitored mailboxes before launch.
 * A privacy policy that names an unreachable address is worse than none.
 */
export const CONTACT = {
  supportEmail: 'support@mocktestspro.com.au',
  privacyEmail: 'privacy@mocktestspro.com.au',
  /** Typical first-response window, stated on the Contact page. */
  responseTime: 'one business day',
  country: 'Australia',
} as const;

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
