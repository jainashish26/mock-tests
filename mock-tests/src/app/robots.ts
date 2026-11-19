import { MetadataRoute } from 'next';
import { INDEXABLE, SITE_URL } from '@/lib/seo/site-config';

/**
 * Routes that must never be crawled or indexed.
 *
 * These are authenticated app surfaces (student/parent/tutor/creator/admin
 * dashboards), API endpoints and auth screens. Blocking them keeps crawl budget
 * focused on the public marketing + blog content that actually needs to rank,
 * and prevents thin, personalised pages from diluting the index.
 */
const DISALLOWED = [
  '/admin/',
  '/creator/',
  '/api/',
  '/student/',
  '/parent/',
  '/tutor/',
  '/auth/',
  '/*.json$',
  '/_next/',
];

/**
 * AI / LLM crawlers that are explicitly allowed to read public content.
 *
 * Generative engine optimisation depends on these agents being able to fetch
 * the blog. Many sites blanket-block them via `User-agent: *` inheritance or
 * aggressive disallow rules, which removes the site from AI answers entirely.
 * Listing them here with an explicit `allow` makes the intent unambiguous.
 *
 * - GPTBot, OAI-SearchBot, ChatGPT-User : OpenAI / ChatGPT search
 * - PerplexityBot, Perplexity-User      : Perplexity (always cites sources)
 * - ClaudeBot, Claude-Web, anthropic-ai : Anthropic / Claude
 * - Google-Extended                     : Gemini training (separate from Googlebot)
 * - Applebot-Extended                   : Apple Intelligence / Siri
 * - Amazonbot, cohere-ai, Bytespider, Meta-ExternalAgent, DuckAssistBot
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'cohere-ai',
  'Bytespider',
  'Meta-ExternalAgent',
  'DuckAssistBot',
  'CCBot',
];

/**
 * Conventional search-engine crawlers. Named explicitly so that the AI-crawler
 * rules above cannot be misread as an exhaustive allow-list.
 */
const SEARCH_CRAWLERS = [
  'Googlebot',
  'Googlebot-Image',
  'Google-InspectionTool',
  'Bingbot',
  'Slurp',
  'DuckDuckBot',
  'Baiduspider',
  'YandexBot',
  'facebookexternalhit',
  'LinkedInBot',
  'Twitterbot',
  'Applebot',
];

/**
 * When the origin must not be indexed, the whole document inverts.
 *
 * A `robots.txt` that invites every crawler in and then relies on a per-page
 * `noindex` is contradictory, and the contradiction has a cost: crawlers spend
 * budget fetching pages that are then refused, and Google's own guidance is that
 * `Disallow` alone does **not** keep a URL out of the index — it only stops it
 * being crawled, so the noindex meta tag never gets read. Blocking everything
 * here while also emitting `noindex` in the page metadata is the pair that works.
 *
 * The sitemap reference is dropped for the same reason: advertising a sitemap of
 * noindexed URLs is asking to be crawled in order to be refused.
 */
export default function robots(): MetadataRoute.Robots {
  if (!INDEXABLE) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }, ...NO_CRAWL],
      // No `sitemap` key. Next omits the directive when it is absent.
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED,
      },
      {
        userAgent: SEARCH_CRAWLERS,
        allow: '/',
        disallow: DISALLOWED,
      },
      {
        // AI engines get full access to marketing + blog content.
        userAgent: AI_CRAWLERS,
        allow: ['/', '/blog', '/blog/*', '/features', '/pricing', '/tests', '/free', '/about'],
        disallow: DISALLOWED,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

/** Every named crawler, told to stay away. Only used on a non-indexable origin. */
const NO_CRAWL = [...SEARCH_CRAWLERS, ...AI_CRAWLERS].map((userAgent) => ({
  userAgent: [userAgent],
  disallow: ['/'],
}));

