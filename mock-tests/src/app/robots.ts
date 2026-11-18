import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site-config';

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

export default function robots(): MetadataRoute.Robots {
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
