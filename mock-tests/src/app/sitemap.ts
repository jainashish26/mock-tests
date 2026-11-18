import { MetadataRoute } from 'next';
import { BLOG_POSTS } from '@/data/blog-posts';
import { BLOG_CATEGORIES } from '@/lib/seo/categories';
import { toIsoDate } from '@/lib/seo/content-utils';
import { SITE_URL, LEGAL_ROUTES, LEGAL_LAST_UPDATED } from '@/lib/seo/site-config';

/**
 * Dynamic sitemap.
 *
 * `lastModified` values are emitted as real ISO dates derived from the post
 * data (`toIsoDate` normalises display strings such as "March 30, 2026").
 * Accurate lastmod is a freshness signal that Google and AI engines use to
 * decide how often to re-crawl - the previous `new Date()` on every entry told
 * crawlers the whole site changed on every deploy.
 */

/** Parse an ISO `YYYY-MM-DD` string into a stable `Date` (UTC midnight). */
function toDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const buildTime = new Date();
  const legalDate = toDate(LEGAL_LAST_UPDATED) ?? buildTime;

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: buildTime, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/blog`, lastModified: buildTime, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/tests`, lastModified: buildTime, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/free`, lastModified: buildTime, changeFrequency: 'weekly', priority: 0.8 },
    // High commercial intent: this is the conversion page, so it ranks above the
    // informational pages despite being newer.
    { url: `${SITE_URL}/pricing`, lastModified: buildTime, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/features`, lastModified: buildTime, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/about`, lastModified: buildTime, changeFrequency: 'monthly', priority: 0.6 },
    // Trust pages. Real privacy/terms/contact routes are an E-E-A-T signal, so
    // they are submitted for crawling rather than left reachable only by footer.
    { url: `${SITE_URL}${LEGAL_ROUTES.privacy}`, lastModified: legalDate, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}${LEGAL_ROUTES.terms}`, lastModified: legalDate, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}${LEGAL_ROUTES.contact}`, lastModified: legalDate, changeFrequency: 'yearly', priority: 0.5 },
  ];

  // Category hubs - crawlable taxonomy pages that group the article library.
  const categoryPages: MetadataRoute.Sitemap = BLOG_CATEGORIES.map((category) => ({
    url: `${SITE_URL}/blog/category/${category.slug}`,
    lastModified: buildTime,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  // Long-form guides are the site's primary ranking + citation assets, so they
  // get higher priority than the previous blanket 0.6.
  const blogPages: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: toDate(toIsoDate(post.updatedDate ?? post.date)) ?? buildTime,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  return [...staticPages, ...categoryPages, ...blogPages];
}
