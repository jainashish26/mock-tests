import { NextResponse } from 'next/server';
import { BLOG_POSTS } from '@/data/blog-posts';
import { BLOG_CATEGORIES, deriveCategory } from '@/lib/seo/categories';
import { readingTimeMinutes, stripHtml } from '@/lib/seo/content-utils';
import {
  AUTHORITATIVE_SOURCES,
  LEGAL_ROUTES,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from '@/lib/seo/site-config';
import { EDITORIAL_POLICY } from '@/lib/seo/authors';

/**
 * Serves `/llms.txt` - the emerging plain-markdown index that LLM-based answer
 * engines read to understand what a site offers and where to find it.
 *
 * It complements (not replaces) sitemap.xml and JSON-LD: the sitemap is for
 * crawlers, JSON-LD is for entity understanding, and llms.txt gives a model a
 * small, self-describing map of the content library it can ingest directly.
 *
 * Generated from the same post data as the rest of the site so it can never
 * drift out of sync.
 */
export const dynamic = 'force-static';

function buildLlmsTxt(): string {
  const lines: string[] = [];

  lines.push(`# ${SITE_NAME}`);
  lines.push('');
  lines.push(`> ${SITE_TAGLINE}`);
  lines.push('');
  lines.push(
    `MockTests Pro publishes evidence-based preparation guides for Australian families. ` +
    `The library covers NAPLAN (Years 3, 5, 7 and 9), Selective School entrance exams, ` +
    `academic scholarship exams (EduTest, ACER, AAS) and Maths Olympiad, alongside ` +
    `parenting and student wellbeing topics. All guides are written for parents and ` +
    `students and are aligned to the current Australian Curriculum.`
  );
  lines.push('');

  lines.push('## Core pages');
  lines.push('');
  lines.push(`- [Home](${SITE_URL}/): Platform overview, adaptive testing and AI essay grading for Years 3-8.`);
  lines.push(`- [Features](${SITE_URL}/features): AI essay grading, adaptive testing, parent dashboards and stress-free exam prep.`);
  lines.push(`- [Pricing](${SITE_URL}/pricing): Three ways to pay - a free tier with no card required, one-time single test purchases kept permanently, or an Unlimited subscription (monthly or annual) covering every test across Years 3-8.`);
  lines.push(`- [Paid Tests](${SITE_URL}/tests): Premium NAPLAN, Selective School and Olympiad practice bundles.`);
  lines.push(`- [Free Tests](${SITE_URL}/free): No-cost diagnostic maths, sample writing and NAPLAN reading practice.`);
  lines.push(`- [About](${SITE_URL}/about): Who we are, our methodology and our editorial standards.`);
  lines.push(`- [Blog index](${SITE_URL}/blog): All ${BLOG_POSTS.length} guides, newest first.`);
  lines.push(`- [Contact](${SITE_URL}${LEGAL_ROUTES.contact}): Support and privacy email addresses, what to include in a message, and contact FAQs.`);
  lines.push(`- [Privacy Policy](${SITE_URL}${LEGAL_ROUTES.privacy}): What data is collected about parents and students, the sub-processors used, AI writing marking, retention and privacy rights.`);
  lines.push(`- [Terms & Conditions](${SITE_URL}${LEGAL_ROUTES.terms}): Eligibility, acceptable use, purchases and refunds, AI feedback disclaimer and limits of liability.`);
  lines.push('');

  // Guides grouped by category - a model can pick the relevant cluster quickly.
  for (const category of BLOG_CATEGORIES) {
    const posts = BLOG_POSTS.filter((p) => deriveCategory(p.tags).slug === category.slug);
    if (posts.length === 0) continue;

    lines.push(`## ${category.name}`);
    lines.push('');
    if (category.description) {
      lines.push(`> ${category.description}`);
      lines.push('');
    }

    for (const post of posts) {
      const summary = stripHtml(post.excerpt).replace(/\s+/g, ' ').trim();
      const minutes = post.readingTime ?? readingTimeMinutes(post.content);
      const published = post.updatedDate ?? post.date;
      lines.push(
        `- [${post.title}](${SITE_URL}/blog/${post.slug}): ${summary} ` +
        `(${minutes} min read, published ${published}.)`
      );
    }
    lines.push('');
  }

  lines.push('## Editorial standards');
  lines.push('');
  lines.push(`- Review process: ${EDITORIAL_POLICY.reviewProcess}`);
  lines.push(`- Update cadence: ${EDITORIAL_POLICY.updateCadence}`);
  lines.push(`- Fact-checked against: ${EDITORIAL_POLICY.factCheckSources.join('; ')}.`);
  lines.push('');

  lines.push('## Primary sources');
  lines.push('');
  for (const source of AUTHORITATIVE_SOURCES) {
    lines.push(`- [${source.name}](${source.url})`);
  }
  lines.push('');

  lines.push('## Optional');
  lines.push('');
  lines.push(`- [Full sitemap](${SITE_URL}/sitemap.xml): machine-readable URL list with lastmod dates.`);
  lines.push('');

  return lines.join('\n');
}

export function GET() {
  return new NextResponse(buildLlmsTxt(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Long-lived: content only changes when a post is added or revised.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'X-Robots-Tag': 'all',
    },
  });
}
